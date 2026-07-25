/**
 * IPC Handler 运行时类型校验工具。
 *
 * 所有函数在校验失败时直接 throw Error，Electron 会自动将异常
 * 序列化为 rejected promise 返回给渲染进程。
 */

const fail = (param: string, expected: string, actual: string): never => {
  throw new Error(`IPC 参数校验失败：${param} 应为 ${expected}，实际为 ${actual}`)
}

/** 校验值为整数 */
export const expectInt = (value: unknown, param: string): void => {
  if (typeof value !== 'number' || !Number.isInteger(value)) fail(param, '整数', typeof value)
}

/** 校验值为字符串 */
export const expectString = (value: unknown, param: string): void => {
  if (typeof value !== 'string') fail(param, '字符串', typeof value)
}

/** 校验值为布尔值 */
export const expectBool = (value: unknown, param: string): void => {
  if (typeof value !== 'boolean') fail(param, '布尔值', typeof value)
}

/** 校验值为非空对象 */
export const expectObject = (value: unknown, param: string): void => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(param, '对象', value === null ? 'null' : Array.isArray(value) ? '数组' : typeof value)
}

/** 校验值可选（允许 undefined，但不允许其他错误类型） */
export const expectOptionalInt = (value: unknown, param: string): void => {
  if (value === undefined || value === null) return
  if (typeof value !== 'number' || !Number.isInteger(value)) fail(param, '整数或空', typeof value)
}

export const expectOptionalString = (value: unknown, param: string): void => {
  if (value === undefined || value === null) return
  if (typeof value !== 'string') fail(param, '字符串或空', typeof value)
}

/** 校验值属于指定枚举 */
export const expectOneOf = <T>(value: unknown, allowed: readonly T[], param: string): T => {
  if (!allowed.includes(value as T)) fail(param, `枚举值 [${allowed.join(', ')}]`, String(value))
  return value as T
}

type FieldType = 'int' | 'string' | 'bool' | 'object'

/** 批量校验对象的必填字段 */
export const expectFields = (obj: unknown, schema: Record<string, FieldType>): void => {
  expectObject(obj, 'input')
  const record = obj as Record<string, unknown>
  for (const [field, type] of Object.entries(schema)) {
    const value = record[field]
    switch (type) {
      case 'int':
        if (typeof value !== 'number' || !Number.isInteger(value)) fail(field, '整数', typeof value)
        break
      case 'string':
        if (typeof value !== 'string') fail(field, '字符串', typeof value)
        break
      case 'bool':
        if (typeof value !== 'boolean') fail(field, '布尔值', typeof value)
        break
      case 'object':
        if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(field, '对象', typeof value)
        break
    }
  }
}
