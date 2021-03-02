'use strict';

const { setupSingleHook } = require('../setup_hooks');
const { compose } = require('../utils');

function translateOptions(spell, options) {
  const { attributes, where, group, order, offset, limit, include } = options;

  if (attributes) spell.$select(attributes);
  if (include) {
    if (typeof include === 'string') spell.$with(include);
  }
  if (where) spell.$where(where);
  if (group) spell.$group(group);
  if (order) {
    if (typeof order === 'string') {
      spell.$order(order);
    } else if (Array.isArray(order) && order.length) {
      const isMultiple = order.some(item=> Array.isArray(item));
      if (isMultiple) {
        // [['created_at', 'asc'], ['id', 'desc']]
        order.map(cond => {
          if (cond.length && cond[0]) {
            spell.$order(cond[0], cond[1] || '');
          }
        });
      } else if (order.some((item) => /^(.+?)\s+(asc|desc)$/i.test(item))) {
        // ['created desc', 'id asc']
        order.map(cond => {
          if (cond) {
            spell.$order(cond);
          }
        });
      } else if (order.length && order[0]) {
        // ['created', 'asc']
        spell.$order(order[0], order[1] || '');
      }
    }
  }
  if (limit) spell.$limit(limit);
  if (offset) spell.$offset(offset);
}

// https://sequelize.org/master/class/lib/model.js~Model.html
// https://sequelize.org/master/manual/model-querying-finders.html
module.exports = Bone => {
  return class Spine extends Bone {

    static get sequelize() {
      return true;
    }

    static addScope(name, scope) {
      throw new Error('unimplemented');
    }

    static init(attributes, opts = {}, descriptors = {}) {
      super.init(attributes, opts, descriptors);

      // sequelize opts.getterMethods | setterMethods
      const { getterMethods = {}, setterMethods = {} } = opts;
      const setProp = (obj, type) =>(result) => {
        Object.keys(obj).map(key => {
          if (!result[key]) {
            result[key] = {
              enumerable: true,
              configurable: true,
            };
          }
          result[key][type] = obj[key];
        });
        return result;
      };
      const overrides = compose(setProp(setterMethods, 'set'), setProp(getterMethods, 'get'))({});
      Object.defineProperties(this.prototype, overrides);
    }

    static aggregate(name, func, options = {}) {
      Object.assign({ plain: true }, options);
      func = func.toLowerCase();

      if (![ 'count', 'average', 'minimum', 'maximum', 'sum' ].includes(func)) {
        throw new Error(`unknown aggregator function ${func}`);
      }

      const { where } = options;
      let spell = this.find(where)[`$${func}`](name);
      if (options.paranoid === false) return spell.unscoped;
      return spell;
    }

    // static belongsTo() {
    //   throw new Error('unimplemented');
    // }

    static belongsToMany() {
      throw new Error('unimplemented');
    }

    static build(values, options = {}) {
      if (options.validate !== false) {
        this._validateAttributes(values);
      }
      const { raw } = Object.assign({ raw: false, isNewRecord: true }, options);
      const { attributes } = this;

      let instance;
      if (raw) {
        //  ignore field and custom setters
        instance = new this(null, options);
        for (const name in attributes) {
          if (values.hasOwnProperty(name)) {
            instance.setDataValue(name, values[name]);
          }
        }
      } else {
        instance = new this(values, options);
      }
      return instance;
    }

    // EXISTS
    // static bulkCreate() {}

    static async count(options = {}) {
      const { where, col, group, paranoid } = options;
      let spell = super.find(where);
      if (Array.isArray(group)) spell.$group(...group);
      if (paranoid === false) spell = spell.unscoped;
      return await spell.$count(col);
    }

    // EXISTS
    // static async create(props) {}

    static decrement(fields, options) {
      const { where, paranoid } = options;
      const spell = super.update(where);

      if (Array.isArray(fields)) {
        for (const field of fields) spell.$decrement(field);
      } else if (fields != null && typeof fields === 'object') {
        for (const field in fields) spell.$decrement(field, fields[field]);
      } else if (typeof fields === 'string') {
        spell.$decrement(fields);
      } else {
        throw new Error(`Unexpected fields: ${fields}`);
      }
      if (paranoid === false) return spell.unscoped;
      return spell;
    }

    // static describe() {
    //   throw new Error('unimplemented');
    // }

    static async destroy(options = {}) {
      const { where, individualHooks } = options;
      if (individualHooks) {
        const instances = await this.find(where);
        if (instances.length) {
          return await Promise.all(instances.map((instance) => instance.destroy(options)));
        }
      } else {
        return await this.bulkDestroy(options);
      }
    }

    // proxy to class.destroy({ individualHooks=false }) see https://github.com/sequelize/sequelize/blob/4063c2ab627ad57919d5b45cc7755f077a69fa5e/lib/model.js#L2895  before(after)BulkDestroy
    static async bulkDestroy(options = {}) {
      const { where, force, hooks } = options;
      return await this.remove(where || {}, force, { hooks });
    }

    // EXISTS
    // static drop() {}

    static findAll(options = {}) {
      let spell = this.find();
      translateOptions(spell, options);
      if (options.paranoid === false) return spell.unscoped;
      return spell;
    }

    static async findAndCountAll(options = {}) {
      let spell = this.find();
      translateOptions(spell, options);
      if (options.paranoid === false) spell = spell.unscoped;
      const [ rows, count ] = await Promise.all([ spell, spell.count() ]);
      return { rows, count };
    }

    static async findByPk(value, options = {}) {
      let spell = super.findOne({ [this.primaryKey]: value });
      if (options.paranoid === false) spell = spell.unscoped;
      return await spell;
    }

    static async findCreateFind(options = {}) {
      const { where, defaults } = options;
      let instance = await this.findOne({ where });

      if (!instance) {
        try {
          instance = await this.create({ ...defaults, ...where });
        } catch (err) {
          instance = await this.findOne({ where });
        }
      }

      return instance;
    }

    static findOne(options) {
      // findOne(null)
      if (arguments.length > 0 && options == null) return null;

      let spell;
      // findOne(id)
      if (typeof options !== 'object') {
        spell = super.findOne(options);
      } else {
        // findOne({ where })
        // findOne()
        // findAll maybe override by developer, that will make it return a non-Spell object
        spell = this.find();
        translateOptions(spell, { ...options, limit: 1 });
        spell = spell.later(result => result[0]);
      }
      if (options && options.paranoid === false) return spell.unscoped;
      return spell;
    }

    static async findOrBuild(options = {}) {
      const { where, defaults, validate } = options;
      const instance = await this.findOne({ where });
      const result = instance || this.build({ ...defaults, ...where }, { validate });
      return [ result, !instance ];
    }

    static async findOrCreate(options) {
      const [ result, built ] = await this.findOrBuild(options);
      if (built) await result.save();
      return [ result, built ];
    }

    static getTableName() {
      return this.table;
    }

    // BREAKING
    // static hasMany() {}

    // BREAKING
    // static hasOne() {}

    static increment(fields, options = {}) {
      const { where, paranoid } = options;
      const spell = super.update(where);

      if (Array.isArray(fields)) {
        for (const field of fields) spell.$increment(field);
      } else if (fields != null && typeof fields === 'object') {
        for (const field in fields) spell.$increment(field, fields[field]);
      } else if (typeof fields === 'string') {
        spell.$increment(fields);
      } else {
        throw new Error(`Unexpected fields: ${fields}`);
      }
      if (paranoid === false) return spell.unscoped;
      return spell;
    }

    static async max(attribute, options = {}) {
      let spell = super.find(options.where).$maximum(attribute);
      if (options.paranoid === false) spell = spell.unscoped;
      return await spell;
    }

    static async min(attribute, options = {}) {
      let spell = super.find(options.where).$minimum(attribute);
      if (options.paranoid === false) spell = spell.unscoped;
      return await spell;
    }

    static removeAttribute(name) {
      const { definition, schema, schemaMap } = this;
      const columnInfo = schema[name];
      delete schema[name];
      delete schemaMap[columnInfo.columnName];
      delete definition[name];
    }

    static restore(options = {}) {
      return super.update(options.where || {}, { deletedAt: null });
    }

    static schema() {
      throw new Error('unimplemented');
    }

    static scope() {
      throw new Error('unimplemented');
    }

    static async sum(attribute, options = {}) {
      let spell = super.find(options.where).$sum(attribute);
      if (options.paranoid === false) spell = spell.unscoped;
      return await spell;
    }

    // EXISTS
    // static async sync() {}

    static truncate() {
      throw new Error('unimplemented');
    }

    static unscoped() {
      const spell = this.find();
      spell.scopes = [];
      return spell;
    }

    static update(values, options = {}) {
      const { where, paranoid = false, validate } = options;
      const whereConditions = where || {};
      const spell = super.update(whereConditions, values, { validate });
      if (!paranoid) return spell.unscoped;
      return spell;
    }

    static upsert(values, options = {}) {
      const instance = new this(values);
      return instance._upsert(options);
    }
    // EXISTS
    // get isNewRecord() {}

    async update(values = {}, options = {}) {
      const { fields } = options;
      const changeValues = {};
      const changedKeys = this.changed();
      if (changedKeys) {
        for (const name of changedKeys) {
          // custom getter should be executed in case there is a custom setter
          changeValues[name] = this[name];
        }
      }

      let changes = {};
      if (fields && fields.length) {
        fields.map(key => {
          if (values[key] !== undefined) changes[key] = values[key];
          else changes[key] = changeValues[key] || this.attribute(key);
        });
      } else {
        changes = {
          ...changeValues,
          ...values,
        };
      }
      const spell = super._update(changes, options);
      // instance update don't need to be paranoid
      return spell.unscoped;
    }
    // EXISTS
    // get isNewRecord() {}

    async decrement(fields, options = {}) {
      const Model = this.constructor;
      const { primaryKey } = Model;
      if (this[primaryKey] == null) {
        throw new Error(`Unset primary key ${primaryKey}`);
      }

      // validate
      if (options.validate !== false) {
        const updateValues = {};
        if (Array.isArray(fields)) {
          for (const field of fields) {
            const value = this[field];
            if (value != null) updateValues[field] = value - 1;
          }
        } else if (fields != null && typeof fields === 'object') {
          for (const field in fields) {
            const value = this[field];
            if (value != null) updateValues[field] = value - Number(fields[field]);
          }
        } else if (typeof fields === 'string') {
          const value = this[fields];
          if (value != null) updateValues[fields] = value - 1;
        } else {
          throw new Error(`Unexpected fields: ${fields}`);
        }
        this._validateAttributes(updateValues);
      }

      return Model.decrement(fields, {
        ...options,
        where: { [primaryKey]: this[primaryKey] },
      });
    }

    async destroy(options = {}) {
      return await this.remove(options.force, { ...options, hooks: false });
    }

    equals() {
      throw new Error('unimplemented');
    }

    equalsOneOf() {
      throw new Error('unimplemented');
    }

    get(key) {
      return this[key];
    }

    getDataValue(key) {
      return this.attribute(key);
    }

    increment(fields, options = {}) {
      const Model = this.constructor;
      const { primaryKey } = Model;
      if (this[primaryKey] == null) {
        throw new Error(`Unset primary key ${primaryKey}`);
      }

      // validate instance only
      if (options.validate !== false) {
        const updateValues = {};
        if (Array.isArray(fields)) {
          for (const field of fields) {
            const value = this[field];
            if (value != null) updateValues[field] = value + 1;
          }
        } else if (fields != null && typeof fields === 'object') {
          for (const field in fields) {
            const value = this[field];
            if (value != null) updateValues[field] = value + Number(fields[field]);
          }
        } else if (typeof fields === 'string') {
          const value = this[fields];
          if (value != null) updateValues[fields] = value + 1;
        } else {
          throw new Error(`Unexpected fields: ${fields}`);
        }
        this._validateAttributes(updateValues);
      }

      return Model.increment(fields, {
        ...options,
        where: { [primaryKey]: this[primaryKey] },
      });
    }

    isSoftDeleted() {
      const { deletedAt } = this.constructor.timestamps;
      return this[deletedAt] != null;
    }

    previous(key) {
      if (key != null) return this.getRawPrevious(key);

      const result = {};
      for (const attrKey of Object.keys(this.constructor.attributes)) {
        const prevValue = this.getRawPrevious(attrKey);
        if (prevValue !== undefined) result[attrKey] = prevValue;
      }
      return result;
    }

    // EXISTS
    // async reload() {}

    // EXISTS
    // restore() {}

    // EXISTS
    // async save() {}

    set(key, value) {
      this[key] = value;
    }

    setDataValue(key, value) {
      this.attribute(key, value);
    }

    // EXISTS
    // async update() {}

    // EXISTS
    // validate() {}

    where() {
      const { primaryKey } = this.constructor;
      return { [primaryKey]: this[primaryKey] };
    }

    /**
     *
     *
     * @static
     * @param {*} hookName before/after create|destroy|upsert|remove|update
     * @param {*} fnNameOrFun function name or function
     * @param {*} func hook function
     */
    static addHook(hookName, fnNameOrFun, func) {
      if (!hookName || (!fnNameOrFun && !func)) return;
      setupSingleHook(this, hookName, typeof fnNameOrFun === 'function'? fnNameOrFun : func);
    }

    static removeHook() {
      throw new Error('unimplemented');
    }
  };
};
