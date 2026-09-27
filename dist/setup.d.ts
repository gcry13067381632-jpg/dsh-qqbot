/** 凭据结果 */
export interface SetupCredentials {
    appId: string;
    appSecret: string;
}
/**
 * 执行 QR 扫码绑定，获取 QQ Bot 凭据
 *
 * 在终端打印二维码等待用户扫码；同时输出扫码 URL，
 * 供二维码因系统字符问题渲染错位时点击/复制到浏览器打开扫码。
 */
export declare function runQrSetup(source?: string): Promise<SetupCredentials | null>;
/**
 * 将凭据写入 dsh profile 的 cordis.patch.yml
 *
 * 行级编辑(不再整文件 YAML 解析)——cordis.patch.yml 常含宿主 `!!js` 自定义标签,
 * js-yaml 无法解析会抛错导致自动保存失败(实测线上文件即因此走到手动引导)。
 * 只定位/更新目标实例条目块(顶层或 `- insert:` 内的 4 空格形态)中的 appId/appSecret 行,
 * 文件其它内容(含 !!js、其它实例、insert 包装)原样保留。
 *
 * ⚠️ 2026-09-10 修复两处线上事故:
 *   1. 旧实现把条目名硬编码成 `im-qqbot`, 对 某实例 这类实例找不到块 →
 *      在文件末尾追加了一个顶层 `- id: im-qqbot`(新版 dsh 无此 entry, 会让整棵插件树加载失败);
 *      现按 instEntryId(来自 config.settingsNs)定位, 且**绝不新建顶层 entry id**。
 *   2. appId 必须写为**带引号的字符串** —— 新版 cordis 严格校验 `$.appId expected string`,
 *      裸数字(appId 示例)会让 preset/插件树整体挂载失败。
 *
 * @param credentials 扫码得到的 appId/appSecret
 * @param profileDir dsh profile 目录(含 cordis.patch.yml)
 * @param logger 日志器
 * @param instEntryId 目标条目 id(即 loader entry id, 默认 `im-qqbot`)
 */
export declare function persistCredentialsToProfile(credentials: SetupCredentials, profileDir?: string, logger?: {
    info(msg: string, ...args: unknown[]): void;
    warn(msg: string, ...args: unknown[]): void;
}, instEntryId?: string): boolean;
//# sourceMappingURL=setup.d.ts.map