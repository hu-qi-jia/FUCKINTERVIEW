/** 实时面试绑定的面试档案（只存在浏览器本地，连接时随 /start 下发）。 */

const LIVE_PROFILE_KEY = "interview-assistant:live-profile";

export function readLiveProfileId(): string | null {
  return localStorage.getItem(LIVE_PROFILE_KEY);
}

export function saveLiveProfileId(id: string | null): void {
  if (id) localStorage.setItem(LIVE_PROFILE_KEY, id);
  else localStorage.removeItem(LIVE_PROFILE_KEY);
}
