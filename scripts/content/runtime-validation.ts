import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import Ajv2020 from 'ajv/dist/2020.js'
import { schemasRoot } from './config'

export async function assertRuntimeSchema(schemaName: string, value: unknown, root = schemasRoot): Promise<void> {
  const schema = JSON.parse(await readFile(resolve(root, 'runtime', schemaName), 'utf8')) as object
  const validator = new Ajv2020({ allErrors: true, strict: true }).compile(schema)
  if (!validator(value)) throw new Error(`${schemaName} failed: ${validator.errors?.map((error) => `${error.instancePath} ${error.message}`).join('; ')}`)
}
