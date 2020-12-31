'use strict';

const Validator = require('validator');

const { isPlainObject } = require('./utils');

const validators = {
  ...Validator,
  notIn(str, values) {
    return !Validator.isIn(str, values);
  },
  notNull(value) {
    return value != null;
  },
  isNull: Validator.isEmpty,
  min(value, target) {
    const number = parseFloat(value);
    return isNaN(number) || number >= target;
  },
  max(value, target) {
    const number = parseFloat(value);
    return isNaN(number) || number <= target;
  },
  contains(str, elem) {
    return !!elem && str.includes(elem);
  },
  notContains(str, elem) {
    return !this.contains(str, elem);
  },
  regex(str, pattern, modifiers) {
    str += '';
    if (Object.prototype.toString.call(pattern).slice(8, -1) !== 'RegExp') {
      pattern = new RegExp(pattern, modifiers);
    }
    const result = str.match(pattern);
    return result ? result.length > 0 : false;
  },
  notRegex(str, pattern, modifiers) {
    return !this.regex(str, pattern, modifiers);
  },
  is(str, pattern, modifiers) {
    return this.regex(str, pattern, modifiers);
  },
};

/**
 *
 * @param {Bone} context
 * @param {string} validateName
 * @param {*} arguments
 * @param {string} field
 * @param {*} value
 */
function executeValidator(ctx, name, field, validateValues, value) {
  const validator = validators[name];
  if (typeof validator !== 'function') throw new Error(`Invalid validator function: ${name}`);
  let args = validateValues;
  let msg = `Validation ${name} on ${field} failed`;
  if (isPlainObject(validateValues)) {
    if ('args' in validateValues) args = validateValues.args;
    msg = validateValues.msg || msg;
  }

  if (Validator.isBoolean(String(validateValues))) {
    if (!validateValues) msg = `Validation ${name}:${String(validateValues)} on ${field} failed`;
    if (validator.call(ctx, String(value)) !== args) throw new Error(msg);
    return;
  }
  if (!validator.call(ctx, String(value), ...args)) throw new Error(msg);
}

module.exports = executeValidator;