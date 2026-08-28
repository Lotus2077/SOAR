import { isDeepStrictEqual } from "node:util";

const supportedKeywords = new Set([
  "$id",
  "$schema",
  "additionalProperties",
  "allOf",
  "const",
  "enum",
  "exclusiveMinimum",
  "format",
  "if",
  "items",
  "minItems",
  "minLength",
  "minimum",
  "pattern",
  "properties",
  "required",
  "then",
  "title",
  "type",
  "uniqueItems",
]);

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function schemaChildren(schema) {
  const children = [];
  if (isObject(schema.properties)) {
    for (const [name, child] of Object.entries(schema.properties)) {
      children.push([`.properties.${name}`, child]);
    }
  }
  if (schema.items !== undefined) children.push([".items", schema.items]);
  if (Array.isArray(schema.allOf)) {
    schema.allOf.forEach((child, index) => children.push([`.allOf[${index}]`, child]));
  }
  if (schema.if !== undefined) children.push([".if", schema.if]);
  if (schema.then !== undefined) children.push([".then", schema.then]);
  return children;
}

function unsupportedSchemaKeywords(schema, path = "$schema") {
  if (!isObject(schema)) return [`${path}: schema node must be an object`];
  const errors = [];
  for (const keyword of Object.keys(schema)) {
    if (!supportedKeywords.has(keyword)) {
      errors.push(`${path}: unsupported schema keyword ${JSON.stringify(keyword)}`);
    }
  }
  for (const [suffix, child] of schemaChildren(schema)) {
    errors.push(...unsupportedSchemaKeywords(child, `${path}${suffix}`));
  }
  return errors;
}

function matchesType(value, type) {
  switch (type) {
    case "array":
      return Array.isArray(value);
    case "boolean":
      return typeof value === "boolean";
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "object":
      return isObject(value);
    case "string":
      return typeof value === "string";
    default:
      return false;
  }
}

function isFullDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return (
    candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() === month - 1 &&
    candidate.getUTCDate() === day
  );
}

function matchesFormat(value, format) {
  if (format === "date") return isFullDate(value);
  if (format === "uri") {
    try {
      const url = new URL(value);
      return url.protocol.length > 1;
    } catch {
      return false;
    }
  }
  return false;
}

function validateNode(value, schema, path) {
  const errors = [];

  if (schema.type !== undefined && !matchesType(value, schema.type)) {
    return [...errors, `${path}: expected ${schema.type}`];
  }

  if (schema.const !== undefined && !isDeepStrictEqual(value, schema.const)) {
    errors.push(`${path}: must equal ${JSON.stringify(schema.const)}`);
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((entry) => isDeepStrictEqual(value, entry))) {
    errors.push(`${path}: must be one of ${schema.enum.map((entry) => JSON.stringify(entry)).join(", ")}`);
  }

  if (typeof value === "string") {
    if (schema.minLength !== undefined && [...value].length < schema.minLength) {
      errors.push(`${path}: must contain at least ${schema.minLength} characters`);
    }
    if (schema.pattern !== undefined && !new RegExp(schema.pattern, "u").test(value)) {
      errors.push(`${path}: must match ${JSON.stringify(schema.pattern)}`);
    }
    if (schema.format !== undefined && !matchesFormat(value, schema.format)) {
      errors.push(`${path}: must match format ${schema.format}`);
    }
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push(`${path}: must be at least ${schema.minimum}`);
    }
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) {
      errors.push(`${path}: must be greater than ${schema.exclusiveMinimum}`);
    }
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(`${path}: must contain at least ${schema.minItems} items`);
    }
    if (schema.uniqueItems === true) {
      for (let left = 0; left < value.length; left += 1) {
        for (let right = left + 1; right < value.length; right += 1) {
          if (isDeepStrictEqual(value[left], value[right])) {
            errors.push(`${path}: items ${left} and ${right} must be unique`);
          }
        }
      }
    }
    if (isObject(schema.items)) {
      value.forEach((entry, index) => {
        errors.push(...validateNode(entry, schema.items, `${path}[${index}]`));
      });
    }
  }

  if (isObject(value)) {
    if (Array.isArray(schema.required)) {
      for (const property of schema.required) {
        if (!Object.hasOwn(value, property)) {
          errors.push(`${path}: missing required property ${JSON.stringify(property)}`);
        }
      }
    }
    if (isObject(schema.properties)) {
      for (const [property, propertySchema] of Object.entries(schema.properties)) {
        if (Object.hasOwn(value, property)) {
          errors.push(...validateNode(value[property], propertySchema, `${path}.${property}`));
        }
      }
      if (schema.additionalProperties === false) {
        for (const property of Object.keys(value)) {
          if (!Object.hasOwn(schema.properties, property)) {
            errors.push(`${path}: unexpected property ${JSON.stringify(property)}`);
          }
        }
      }
    }
  }

  if (Array.isArray(schema.allOf)) {
    for (const child of schema.allOf) errors.push(...validateNode(value, child, path));
  }
  if (isObject(schema.if) && validateNode(value, schema.if, path).length === 0) {
    if (isObject(schema.then)) errors.push(...validateNode(value, schema.then, path));
  }

  return errors;
}

export function validateJsonSchema(value, schema, options = {}) {
  const label = options.label ?? "$";
  const unsupported = unsupportedSchemaKeywords(schema);
  if (unsupported.length > 0) {
    throw new Error(`Schema uses unsupported features:\n${unsupported.join("\n")}`);
  }
  return validateNode(value, schema, label);
}
