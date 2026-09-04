/**
 * dsh-settings 最小类型声明(本地 stub)。
 * 运行时 @deepseek-ai/dsh-settings 由 dsh 宿主(peer)解析提供; 此处仅编译期类型,
 * 避免工程内安装宿主副本(双包铁律)。只声明本插件用到的 API 形状。
 */
declare module '@deepseek-ai/dsh-settings' {
  import type { Context } from '@deepseek-ai/cordis';

  /** 设置命名空间(品牌字符串) */
  export type SettingsNamespace = string & { readonly __brand?: 'dshSettingsNamespace' };

  /** 品牌化命名空间 */
  export function settingsNamespace(value: string): SettingsNamespace;

  /** 注册方钩子: 收到权威取值源 thunk 与变更通知 */
  export interface SettingsSectionHooks<T> {
    setSource(current: () => T): void;
    onChange(): void;
  }

  /**
   * 可选 settings 消费标准接线: settings 服务存在时注册 ns(entry 为 base 层),
   * 服务缺失/卸载时自动回落 entry。schema 用 schemastery Schema(本 stub 以 unknown 接收)。
   */
  export function installSettingsSection<T>(
    ctx: Context,
    ns: SettingsNamespace,
    schema: unknown,
    entry: T,
    hooks: SettingsSectionHooks<T>,
  ): void;
}
