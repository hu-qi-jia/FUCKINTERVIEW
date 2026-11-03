/** 存储路径的小工具：模型目录默认放在数据目录的 models/ 下。 */

export function modelsDirFor(dataDir: string): string {
  const trimmed = dataDir.replace(/[\\/]+$/, "");
  const separator = trimmed.includes("\\") ? "\\" : "/";
  return `${trimmed}${separator}models`;
}

export function samePath(left: string, right: string): boolean {
  const normalize = (value: string) =>
    value.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  return normalize(left) === normalize(right);
}
