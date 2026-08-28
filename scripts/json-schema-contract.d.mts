export interface ValidateJsonSchemaOptions {
  label?: string;
}

export function validateJsonSchema(
  value: unknown,
  schema: unknown,
  options?: ValidateJsonSchemaOptions,
): string[];
