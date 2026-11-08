/**
 * Minimal stand-in for `@deepseek-ai/schemastery`.
 *
 * The entry-point test needs the module graph to load, the export names to be
 * present, and the schema to be callable the way Cordis calls it. Behavioural
 * validation of the real schema runs separately against the runtime package;
 * this stub deliberately keeps defaults and validation inert so a schema change
 * cannot be mistaken for a passing test.
 */

function chainable(type) {
  // Real schemastery schemas are callable functions carrying chain methods, and
  // they implement Standard Schema (`~standard.validate`), which Cordis uses.
  const schema = data => (data !== null && typeof data === 'object' ? { ...data } : data)
  schema.type = type
  schema['~standard'] = {
    version: 1,
    vendor: 'dsh-plugin-matlab-test-stub',
    validate: value => ({ value }),
  }
  for (const method of ['default', 'description', 'volatile', 'pattern', 'min', 'max', 'required']) {
    schema[method] = value => {
      schema[`_${method}`] = value
      return schema
    }
  }
  schema.toString = () => type
  return schema
}

const Schema = {
  object: fields => {
    const schema = chainable('object')
    schema.fields = fields
    return schema
  },
  string: () => chainable('string'),
  number: () => chainable('number'),
  natural: () => chainable('natural'),
  boolean: () => chainable('boolean'),
  array: inner => {
    const schema = chainable('array')
    schema.inner = inner
    return schema
  },
  dict: inner => {
    const schema = chainable('dict')
    schema.inner = inner
    return schema
  },
  union: list => {
    const schema = chainable('union')
    schema.list = list
    return schema
  },
  const: value => {
    const schema = chainable('const')
    schema.value = value
    return schema
  },
  lazy: callback => chainable('lazy'),
  transform: (inner, callback) => chainable('transform'),
}

export default Schema
export { Schema }
