/**
 * 模型路由层类型定义
 */

/** 模型路由 */
export interface ModelRoute {
  provider: string;
  model: string;
}

/** 模型信息条目 */
export interface ModelEntry {
  provider: string;
  id: string;
  name?: string;
}
