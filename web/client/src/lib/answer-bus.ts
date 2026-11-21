/**
 * 回答列表的跨窗口通道。
 *
 * 主窗口那一路在攒回答（见 `ConsoleAnswerPanel`），悬浮窗只负责显示，
 * 所以两个窗口之间直接通消息就行：同源页面用 BroadcastChannel，不用绕主进程。
 * 「显示 / 隐藏窗口」「结束面试」这类桌面动作才走 IPC。
 *
 * 悬浮窗是面试中途才开的，开的时候手上的回答得补一份过去——
 * 所以有 request / onRequested 这一对。
 */

export interface AnswerTurn {
  id: string;
  text: string;
  createdAt: string;
  final: boolean;
}

const CHANNEL_NAME = "interview-answers";

type Packet =
  | { type: "answers"; turns: AnswerTurn[] }
  | { type: "session"; startAt: number | null }
  | { type: "state:request" };

/** 复用一个发信通道：每次新建会在窗口里堆一个没人关的实例。 */
let sender: BroadcastChannel | null = null;

function send(packet: Packet): void {
  if (typeof BroadcastChannel === "undefined") return;
  if (!sender) sender = new BroadcastChannel(CHANNEL_NAME);
  sender.postMessage(packet);
}

/** 只收对方发来的消息；自己 post 的不会回到自己这。 */
function listen(handler: (packet: Packet) => void): () => void {
  if (typeof BroadcastChannel === "undefined") return () => {};
  const channel = new BroadcastChannel(CHANNEL_NAME);
  channel.onmessage = (event: MessageEvent<Packet>) => handler(event.data);
  return () => channel.close();
}

/** 主窗口：回答列表变了就广播一份。 */
export function publishAnswers(turns: AnswerTurn[]): void {
  send({ type: "answers", turns });
}

/** 悬浮窗：收回答列表。返回退订函数。 */
export function subscribeAnswers(
  handler: (turns: AnswerTurn[]) => void,
): () => void {
  return listen((packet) => {
    if (packet.type === "answers") handler(packet.turns);
  });
}

/** 主窗口：面试计时起点（`InterviewTimer` 的 startAt）变了就广播一份。 */
export function publishSession(startAt: number | null): void {
  send({ type: "session", startAt });
}

/** 悬浮窗：收计时起点。返回退订函数。 */
export function subscribeSession(
  handler: (startAt: number | null) => void,
): () => void {
  return listen((packet) => {
    if (packet.type === "session") handler(packet.startAt);
  });
}

/**
 * 悬浮窗：刚打开时向主窗口要一份已经攒下的。
 * 回答和计时起点各有各的人守着（回答在 ConsoleAnswerPanel，起点在首页），
 * 谁被叫到谁把自己那份发一遍。
 */
export function requestState(): void {
  send({ type: "state:request" });
}

/** 主窗口：悬浮窗来要了，把手上的发一份过去。 */
export function onStateRequested(handler: () => void): () => void {
  return listen((packet) => {
    if (packet.type === "state:request") handler();
  });
}
