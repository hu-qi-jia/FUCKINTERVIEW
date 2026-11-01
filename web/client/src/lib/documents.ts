/** 其他资料（面试时展示的 md / pdf）的前端数据模型与接口。 */

import { json, request } from "@/lib/http";

export type DocumentKind = "md" | "pdf";

export interface OtherDocument {
  id: string;
  title: string;
  filename: string;
  ext: DocumentKind;
  size: number;
  createdAt: string;
}

/** 单个文件上限，和后端保持一致。 */
export const MAX_DOCUMENT_BYTES = 100 * 1024 * 1024;

export const DOCUMENT_ACCEPT = ".md,.pdf,text/markdown,application/pdf";

export async function listDocuments(): Promise<OtherDocument[]> {
  const data = await request<{ documents: OtherDocument[] }>("/api/documents");
  return data.documents ?? [];
}

export async function uploadDocument(file: File): Promise<OtherDocument> {
  const body = new FormData();
  body.append("file", file);
  return request<OtherDocument>("/api/documents", { method: "POST", body });
}

export async function renameDocument(
  id: string,
  title: string,
): Promise<OtherDocument> {
  return request<OtherDocument>(
    `/api/documents/${id}`,
    json("PATCH", { title }),
  );
}

export async function deleteDocument(id: string): Promise<void> {
  await request<{ ok: boolean }>(`/api/documents/${id}`, { method: "DELETE" });
}

/** 原件地址；PDF 按 Range 分片读取，md 直接取文本。 */
export function documentFileUrl(id: string): string {
  return `/api/documents/${id}/file`;
}
