import type { ApiErrorData, Method, Requests } from '../shared/types';
export class ApiError extends Error {
  constructor(public data: ApiErrorData) { super(data.message); }
}
export async function call<K extends Method>(method: K, input: Requests[K]['input']): Promise<Requests[K]['output']> {
  if (!window.skillRegistry) throw new ApiError({ code: 'HOST', message: '请在 uTools 中导入构建后的插件，再打开 SkillRegistory。' });
  const response = await window.skillRegistry.call(method, input);
  if (!response.ok) throw new ApiError(response.error);
  return response.data;
}
export const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);
