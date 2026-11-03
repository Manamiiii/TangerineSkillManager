import type { Bridge, Commands } from '../shared/types';
import { errorHelp, displayMessage } from './messages';
declare global {
  interface Window {
    skillManager?: Bridge;
  }
}
export async function request<K extends keyof Commands>(
  command: K,
  input: Commands[K]['input'],
): Promise<Commands[K]['output']> {
  if (!window.skillManager) throw new Error('请在桌面应用中使用此功能。运行 npm start 启动完整应用。');
  const result = await window.skillManager.request(command, input);
  if (!result.ok)
    throw new Error(
      `${result.error.code} · ${errorHelp[result.error.code] ?? displayMessage(result.error.message)}`,
    );
  return result.value;
}
