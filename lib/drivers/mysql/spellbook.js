'use strict';

const SqlString = require('sqlstring');

const { Hint, IndexHint } = require('../../hint');

const spellbook = require('../abstract/spellbook');

/**
 * INSERT ... ON DUPLICATE KEY UPDATE
 * - http://dev.mysql.com/doc/refman/5.7/en/insert-on-duplicate.html
 * @param {Spell} spell
 */
function formatMysqlUpsert(spell) {
  const { Model, sets } = spell;
  const { shardingKey } = Model;

  if (shardingKey && sets[shardingKey] == null) {
    throw new Error(`Sharding key ${Model.table}.${shardingKey} cannot be NULL`);
  }

  const { driver, primaryKey, primaryColumn } = Model;
  const { sql, values } = spellbook.formatInsert(spell);
  const assigns = [];
  const { createdAt } = Model.timestamps;

  // Make sure the correct LAST_INSERT_ID is returned.
  // - https://stackoverflow.com/questions/778534/mysql-on-duplicate-key-last-insert-id
  assigns.push(`${driver.escapeId(primaryColumn)} = LAST_INSERT_ID(${driver.escapeId(primaryColumn)})`);

  for (const name of Object.keys(sets)) {
    if (name !== primaryKey && !(createdAt && name === createdAt)) {
      assigns.push(`${driver.escapeId(Model.unalias(name))} = ?`);
      const value = sets[name];
      if (value && value.__raw) {
        // raw sql
        values.push(SqlString.raw(value.value));
      } else {
        values.push(sets[name]);
      }
    }
  }

  return {
    sql: `${sql} ON DUPLICATE KEY UPDATE ${assigns.join(', ')}`,
    values
  };
}

module.exports = {
  ...spellbook,

  formatOptimizerHints(spell) {
    const optimizerHints = spell.hints.filter(hint => hint instanceof Hint);
    if (Array.isArray(optimizerHints) && optimizerHints.length > 0) {
      const hints = optimizerHints.map(hint => hint.toSqlString()).join(' ');
      return `/*+ ${hints} */`;
    }
    return '';
  },

  formatIndexHints(spell) {
    const indexHints = spell.hints.filter(hint => hint instanceof IndexHint);
    if (Array.isArray(indexHints) && indexHints.length > 0) {
      const hints = IndexHint.merge(indexHints);
      return hints.map(hint => hint.toSqlString()).join(' ');
    }
    return '';
  },

  formatUpsert(spell) {
    return formatMysqlUpsert(spell);
  },
};
