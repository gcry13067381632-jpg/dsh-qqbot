/* qqbot-settings — browser half (hand-written __ModuleLoader__ bundle, no build step).
 * 在设置页新增「QQ 机器人 (im-qqbot)」整页: 读/写 im-qqbot settings ns,
 * 数据经 host 半边同源路由 /api/qqbot-settings/{read,update}。
 */
window.__ModuleLoader__.load({
  id: '@zaofan/dsh-qqbot',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    var React = require('react')
    var h = React.createElement
    var useState = React.useState
    var useEffect = React.useEffect

    var READ = '/api/qqbot-settings/read'
    var UPDATE = '/api/qqbot-settings/update'

    var labelStyle = { display: 'block', margin: '6px 0', fontSize: 13 }
    var inputStyle = { marginLeft: 8, padding: '2px 6px', border: '1px solid #8884', borderRadius: 4, background: 'transparent', color: 'inherit', width: 110 }
    var wideStyle = { ...inputStyle, width: 260 }
    var fullStyle = { ...inputStyle, width: '92%', display: 'block', margin: '4px 0 8px' }
    var boxStyle = { border: '1px solid #e5e6eb', borderRadius: 8, padding: '10px 14px 12px', margin: '8px 0', background: '#fff' }
    var sectionTitle = { fontWeight: 600, margin: '10px 0 4px', fontSize: 14, color: '#1f2329' }

    // ── 迷你设计系统(2026-09-05 专家团定稿; 深色柔和适配宿主, 不刺眼) ──
    // 宿主 dsh web 为深色主题 → 卡片用半透明深色、文字浅色、主色用低饱和紫(贴合 #9775fa 系)
    var T = {
      bg: 'transparent', card: '#ffffff', cardHi: '#fafafa', cardSolid: '#f4f5f8', border: '#e2e5ea', borderLight: '#eef0f3',
      text: '#1f2329', text2: '#4e5560', text3: '#8a919c',
      primary: '#7c6cf0', primary2: '#6b5ae6', primaryBg: '#7c6cf01a', primaryBorder: '#7c6cf04d',
      danger: '#e5484d', dangerBg: '#e5484d14',
      success: '#1f9e4f', successBg: '#1f9e4f14',
      warn: '#d97706', warnBg: '#d9770614',
      radius: 6, radiusLg: 10,
      shadow: 'none',
      fs: 13, fsSm: 12, fsTitle: 14,
    }
    var pageBg = { background: T.bg, borderRadius: T.radiusLg, padding: '12px 16px', minHeight: 300 }
    var card = { background: T.card, border: '1px solid ' + T.border, borderRadius: T.radius }
    function btnStyle(variant, size) {
      var base = {
        border: '1px solid ' + T.border, borderRadius: T.radius, cursor: 'pointer', font: 'inherit',
        padding: size === 'sm' ? '2px 10px' : '4px 14px', fontSize: size === 'sm' ? 12 : 13, lineHeight: '20px', whiteSpace: 'nowrap',
        transition: 'background .15s, border-color .15s, color .15s',
      }
      if (variant === 'primary') return { ...base, background: T.primaryBg, color: T.primary, borderColor: T.primaryBorder, fontWeight: 600 }
      if (variant === 'danger') return { ...base, background: T.dangerBg, color: T.danger, borderColor: '#f7656044', fontWeight: 600 }
      if (variant === 'ghost') return { ...base, background: 'transparent', color: T.text2 }
      return { ...base, background: T.card, color: T.text }
    }
    function SButton(props) {
      return h('button', { className: 'qqs-btn', style: btnStyle(props.variant, props.size), disabled: props.disabled, onClick: props.onClick }, props.children)
    }
    // 状态条: tone=info/danger/success/warn; 深色柔底 + 左圆标; action=可选右侧行动按钮
    function StatusBar(props) {
      var m = { info: [T.primaryBg, T.primary], danger: [T.dangerBg, T.danger], success: [T.successBg, T.success], warn: [T.warnBg, T.warn] }[props.tone || 'info'] || [T.primaryBg, T.primary]
      var icon = props.tone === 'danger' ? '!' : props.tone === 'success' ? '✓' : props.tone === 'warn' ? '⚠' : 'i'
      return h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, background: m[0], border: '1px solid ' + m[1] + '44', borderRadius: T.radius, padding: '6px 12px', margin: '8px 0', fontSize: T.fsSm } },
        h('span', { style: { flexShrink: 0, width: 18, height: 18, borderRadius: '50%', background: m[1], color: '#fff', textAlign: 'center', lineHeight: '18px', fontSize: 11, fontWeight: 700 } }, icon),
        h('span', { style: { flex: 1, color: m[1] } }, props.children),
        props.action ? h(SButton, { variant: props.tone === 'danger' ? 'danger' : 'primary', size: 'sm', onClick: props.action.onClick }, props.action.label) : null)
    }
    // 空状态
    function Empty(props) {
      return h('div', { style: { padding: '36px 0', textAlign: 'center', color: T.text3 } },
        h('div', { style: { fontSize: 34, marginBottom: 8, opacity: .5 } }, props.icon || '🕳'),
        h('div', { style: { fontSize: T.fsSm } }, props.text || '暂无数据'))
    }
    // 简易表格: cols=[{key,title,width?,render?}], rows=[]; 空态走 Empty (深色适配)
    function DataTable(props) {
      var cols = props.cols || []
      var rows = props.rows || []
      if (rows.length === 0) return h(Empty, { text: props.emptyText || '暂无数据' })
      return h('div', { style: { border: '1px solid #dde1e7', borderRadius: T.radius, overflow: 'hidden', background: T.card } },
        h('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: T.fsSm } },
          h('thead', null, h('tr', { style: { background: T.cardHi } },
            cols.map(function (c) { return h('th', { key: c.key, style: { padding: '8px 10px', textAlign: 'left', fontWeight: 600, color: T.text2, borderBottom: '1px solid #dde1e7', width: c.width || undefined } }, c.title) }))),
          h('tbody', null, rows.map(function (r, i) {
            return h('tr', { key: i, style: { background: i % 2 ? T.card : T.cardHi } },
              cols.map(function (c) {
                var v = r[c.key]
                var cell = c.render ? c.render(v, r) : (v === null || v === undefined ? '' : String(v))
                return h('td', { key: c.key, style: { padding: '8px 10px', borderBottom: '1px solid #eef0f3', color: T.text } }, cell)
              }))
          }))))
    }
    // 横排 TabBar: items=[{key,label,badge?}]
    function TabBar(props) {
      return h('div', { style: { display: 'flex', gap: 2, borderBottom: '1px solid ' + T.border, marginBottom: 4 } },
        (props.items || []).map(function (it) {
          var on = it.key === props.value
          return h('div', { key: it.key, onClick: function () { props.onChange && props.onChange(it.key) }, style: { cursor: 'pointer', padding: '8px 14px', fontSize: T.fsSm, color: on ? T.primary : T.text2, fontWeight: on ? 600 : 400, borderBottom: on ? '2px solid ' + T.primary : '2px solid transparent', marginBottom: -1, display: 'flex', alignItems: 'center', gap: 6 } },
            it.label,
            it.badge > 0 ? h('span', { style: { background: T.danger, color: '#fff', borderRadius: 9, padding: '0 6px', fontSize: 11, lineHeight: '16px', fontWeight: 700 } }, it.badge) : null)
        }))
    }

    // 可搜索选择器(选聊天对象用): 点击弹出候选浮层, 输入即过滤; 选中回调 onPick({scope,id,name})
    function TargetPicker(props) {
      var [open, setOpen] = useState(false)
      var [q, setQ] = useState('')
      var val = props.value || {}
      function cands() {
        var all = props.options || []
        var t = q.trim().toLowerCase()
        if (!t) return all
        return all.filter(function (c) { return (c.name || '').toLowerCase().indexOf(t) >= 0 || String(c.id).toLowerCase().indexOf(t) >= 0 })
      }
      var gs = cands().filter(function (c) { return c.scope === 'group' })
      var cs = cands().filter(function (c) { return c.scope === 'c2c' })
      var label = val.name || (val.targetId ? String(val.targetId).slice(0, 8) : '')
      var sec = { fontSize: 10, color: T.text3, padding: '3px 6px 1px', fontWeight: 600 }
      var item = { cursor: 'pointer', padding: '4px 8px', borderRadius: 4, fontSize: T.fsSm, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }
      function pick(c) { setOpen(false); setQ(''); props.onPick && props.onPick({ scope: c.scope, id: c.id, name: c.name || '' }) }
      return h('div', { style: { position: 'relative', flex: 1, minWidth: 0 } },
        h('div', { onClick: function () { setOpen(!open); setQ('') }, style: { cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, padding: '2px 8px', minHeight: 22, border: '1px solid ' + T.border, borderRadius: T.radius, background: T.card, fontSize: T.fsSm, color: label ? T.text : T.text3, userSelect: 'none' } },
          h('span', { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, label ? '『' + label + '』' : '(未选,点此搜索)'),
          h('span', { style: { fontSize: 10, color: T.text3 } }, '▾')),
        open ? h('div', { style: { position: 'absolute', top: '100%', left: 0, zIndex: 60, minWidth: 250, marginTop: 2, background: T.card, border: '1px solid ' + T.border, borderRadius: T.radius, boxShadow: '0 6px 18px rgba(0,0,0,.12)', padding: 6 } },
          h('input', { className: 'qqs-inp', style: { width: '100%', boxSizing: 'border-box', padding: '3px 8px', marginBottom: 4, fontSize: T.fsSm }, autoFocus: true, placeholder: '搜群名 / 昵称 / ID…', value: q, onChange: function (e) { setQ(e.target.value) } }),
          gs.length + cs.length === 0 ? h('div', { style: { padding: '8px 6px', color: T.text3, fontSize: T.fsSm, textAlign: 'center' } }, '没有匹配的聊天') : null,
          gs.length ? h('div', { style: sec }, '群') : null,
          gs.map(function (c) { return h('div', { key: 'g:' + c.id, style: item, onMouseDown: function (ev) { ev.preventDefault(); pick(c) }, onMouseEnter: function (e) { e.currentTarget.style.background = T.cardHi }, onMouseLeave: function (e) { e.currentTarget.style.background = 'transparent' } }, '👥 ' + (c.name || c.id)) }),
          cs.length ? h('div', { style: sec }, '私聊') : null,
          cs.map(function (c) { return h('div', { key: 'c:' + c.id, style: item, onMouseDown: function (ev) { ev.preventDefault(); pick(c) }, onMouseEnter: function (e) { e.currentTarget.style.background = T.cardHi }, onMouseLeave: function (e) { e.currentTarget.style.background = 'transparent' } }, '💬 ' + (c.name || c.id)) })) : null)
    }

    // 群聊守则"恢复默认"用: 与主包 dsh-qqbot config.ts 的 DEFAULT_GROUP_PROMPT 保持一致。
    // ⚠️ 若改主包默认文本, 必须同步改这里(唯一同步点)。
    var DEFAULT_GROUP_PROMPT = [
      '【表情包礼仪】你有一座本地表情包库(群友存的图,带标签)。想用表情包回应时先调 list_stickers 搜库,命中后再用 send_media 发出,别发没把握的图。',
      '只在群里正热闹、情绪正浓时,才在回复末尾附 0~1 张:满屏哈哈/笑死(爆笑)、大家"确实/我也是"(共鸣)、有人抛梗你能接住(接梗)、有人当面夸你(被夸)、轻度吐槽可以接治愈/滑稽图。',
      '绝不发:冷场没人接话、正事/技术问答/找资源、吵架互怼中、对方难过或聊严肃事、私聊。',
      '出手前自检,缺一不发:①库里有 9 成贴切的图;②发出来群友会心一笑;③这轮没发过、今天这群没刷过图。',
      '把图删掉话照样完整;一次最多一张;发离谱/冒犯/色气/羞辱人的图=人设崩塌,永远不许。',
    ].join('\n')

    function nv(v) { return typeof v === 'number' && isFinite(v) ? v : 0 }
    function sv(v) { return typeof v === 'string' ? v : '' }
    function esc(v) { return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') }

    function BoolRow(props) {
      return h('label', { style: labelStyle },
        props.label,
        h('input', { className: 'qqs-inp',
          type: 'checkbox', style: inputStyle, checked: !!props.value,
          onChange: (e) => props.onChange(e.target.checked),
        }))
    }
    function NumRow(props) {
      return h('label', { style: labelStyle },
        props.label,
        h('input', { className: 'qqs-inp',
          type: 'number', style: inputStyle, value: nv(props.value),
          onChange: (e) => props.onChange(Number(e.target.value)),
        }))
    }
    function StrRow(props) {
      return h('label', { style: labelStyle },
        props.label,
        h('input', { className: 'qqs-inp', style: props.wide ? wideStyle : inputStyle, value: sv(props.value), onChange: (e) => props.onChange(e.target.value) }))
    }

    function RuleEditor(props) {
      var r = props.rule
      function upd(patch) { props.onChange({ ...r, ...patch }) }
      function condUpd(patch) { upd({ conditions: { ...r.conditions, ...patch } }) }
      return h('div', { style: boxStyle },
        h('label', { style: labelStyle },
          h('input', { className: 'qqs-inp',
            type: 'checkbox', checked: !!r.enabled,
            onChange: (e) => upd({ enabled: e.target.checked }),
          }), ' 启用这条提醒 ' + ((r.name || r.id) + (r.name && r.name !== r.id ? ' (' + r.id + ')' : ''))),
        h('label', { style: labelStyle },
          h('input', { className: 'qqs-inp',
            type: 'checkbox', checked: !!r.conditions.hasImage,
            onChange: (e) => condUpd({ hasImage: e.target.checked }),
          }), ' 消息里带图片 ',
          h('input', { className: 'qqs-inp',
            type: 'checkbox', checked: !!r.conditions.hasLink,
            onChange: (e) => condUpd({ hasLink: e.target.checked }),
          }), ' 消息里带链接 '),
        h('label', { style: labelStyle }, ' 按固定写法匹配文字(高手用,留空=不用): ',
          h('input', { className: 'qqs-inp', style: wideStyle, value: sv(r.conditions.contentRegex), placeholder: '如 ^早安', onChange: (e) => condUpd({ contentRegex: e.target.value }) })),
        h('label', { style: labelStyle }, ' 出现这些词就触发(逗号分隔): ',
          h('input', { className: 'qqs-inp', style: wideStyle, value: (r.conditions.contentKeywords || []).join(','), onChange: (e) => condUpd({ contentKeywords: e.target.value.split(/[,，]/).map(function (s) { return s.trim() }).filter(Boolean) }) })),
        h('label', { style: labelStyle }, ' 多个条件怎么算: ',
          h('select', { style: inputStyle, value: r.conditions.matchScope || 'any', onChange: (e) => condUpd({ matchScope: e.target.value }) },
            h('option', { value: 'any' }, '满足一个就行'),
            h('option', { value: 'all' }, '全部都要满足'))),
        h('div', { style: labelStyle }, '要提醒她的内容:'),
        h('textarea', { className: 'qqs-area',
          style: fullStyle, rows: 2, value: sv(r.prompt),
          placeholder: '例:上方含链接,引用前先核实',
          onChange: (e) => upd({ prompt: e.target.value }),
        }),
        h('button', { className: 'qqs-btn', style: { marginTop: 4 }, onClick: () => props.onRemove(r.id) }, '删除这条提醒'))
    }

    function SettingsPage(props) {
      var close = props && props.close
      // 多账号: 当前操作账号的 settings 命名空间(主=im-qqbot 不带参, 其它=实例 id)
      var _acctNs = props && props.acct && props.acct.ns && props.acct.ns !== 'im-qqbot' ? String(props.acct.ns) : ''
      var [cfg, setCfg] = useState(null)
      var [rev, setRev] = useState(undefined)
      var [msg, setMsg] = useState('')

      function load() {
        setMsg('加载中…')
        fetch(READ + (_acctNs ? '?ns=' + encodeURIComponent(_acctNs) : '')).then(function (r) { return r.json() }).then(function (d) {
          if (d && d.value) {
            var v = d.value
            var base = {
              behavior: v.behavior || {},
              sticker: v.sticker || {},
              injectRules: Array.isArray(v.injectRules) ? v.injectRules : [],
              imageHint: typeof v.imageHint === 'boolean' ? v.imageHint : undefined,
              messageReference: v.messageReference !== false,
              schedule: v.schedule && Array.isArray(v.schedule.targets) ? v.schedule : { targets: [] },
              // groupPrompt 必须读回来, 否则每次保存都会把它清空成 ''
              // undefined(从未设置)→ 显示默认守则; ''(用户明确清空)→ 保持空(无守则)
              groupPrompt: typeof v.groupPrompt === 'string' ? v.groupPrompt : DEFAULT_GROUP_PROMPT,
              enableApprovals: v.enableApprovals === true,
              approvalTimeoutMs: typeof v.approvalTimeoutMs === 'number' ? v.approvalTimeoutMs : 120000,
              outboundMode: (v.outboundMode === 'detail' || v.outboundMode === 'passive' || v.outboundMode === 'silent' || v.outboundMode === 'nothink' ? v.outboundMode : 'adaptive'),
              groupAdmin: { enabled: v.groupAdmin && v.groupAdmin.enabled === true, owners: Array.isArray(v.groupAdmin && v.groupAdmin.owners) ? v.groupAdmin.owners : [], manageGroup: v.groupAdmin && typeof v.groupAdmin.manageGroup === 'string' ? v.groupAdmin.manageGroup : '', watchJoinRequests: !!(v.groupAdmin && v.groupAdmin.watchJoinRequests), notifyInGroup: v.groupAdmin && v.groupAdmin.notifyInGroup !== false },
            }
            setCfg(base); setRev(d.revision); setMsg('')
          } else { setMsg('读取失败: ' + JSON.stringify(d)) }
        }).catch(function (e) { setMsg('读取异常: ' + e.message) })
      }
      useEffect(function () { load() }, [])

      if (!cfg) return h('div', null, h('p', null, msg || '加载中…'))

      var gates = cfg.sticker.gates || {}
      var dbc = cfg.behavior.debounce || {} // 延迟聚合(后端未设置时缺省回落默认值)
      function setBehavior(p) { setCfg(function (c) { return { ...c, behavior: { ...c.behavior, ...p } } }) }
      function setGates(p) { setCfg(function (c) { return { ...c, sticker: { ...c.sticker, gates: { ...(c.sticker.gates || {}), ...p } } } }) }
      function setSticker(p) { setCfg(function (c) { return { ...c, sticker: { ...(c.sticker || {}), ...p } } }) }
      function setGroupAdmin(p) { setCfg(function (c) { return { ...c, groupAdmin: { ...(c.groupAdmin || { enabled: false, owners: [] }), ...p } } }) }
      function setRules(list) { setCfg(function (c) { return { ...c, injectRules: list } }) }

      function addRule() {
        var list = (cfg.injectRules || []).slice()
        list.push({
          id: 'rule-' + Date.now().toString(36),
          name: '',
          enabled: true,
          conditions: { hasImage: false, hasLink: false, contentRegex: '', contentKeywords: [], matchScope: 'any' },
          prompt: '',
        })
        setRules(list)
      }
      function updRule(i, r) { var list = cfg.injectRules.slice(); list[i] = r; setRules(list) }
      function rmRule(id) { setRules(cfg.injectRules.filter(function (r) { return r.id !== id })) }

      // gpOverride: 传入字符串 = 用该守则保存(恢复默认用); undefined = 用当前编辑框内容
      function doSave(gpOverride) {
        setMsg('保存中…')
        var patch = {
          behavior: cfg.behavior,
          sticker: {
            gates: cfg.sticker.gates,
            autoTagEnabled: cfg.sticker.autoTagEnabled,
            visionCli: cfg.sticker.visionCli,
          },
          injectRules: cfg.injectRules,
          // 定时唤醒(④)已并入「定时任务」页编辑; 这里原样带过不丢即可
          schedule: cfg.schedule && Array.isArray(cfg.schedule.targets) ? cfg.schedule : { targets: [] },
          groupPrompt: typeof gpOverride === 'string' ? gpOverride : (typeof cfg.groupPrompt === 'string' ? cfg.groupPrompt : ''),
          enableApprovals: cfg.enableApprovals === true,
          approvalTimeoutMs: typeof cfg.approvalTimeoutMs === 'number' ? cfg.approvalTimeoutMs : 120000,
          outboundMode: cfg.outboundMode === 'detail' || cfg.outboundMode === 'passive' || cfg.outboundMode === 'silent' || cfg.outboundMode === 'nothink' ? cfg.outboundMode : 'adaptive',
          groupAdmin: { enabled: cfg.groupAdmin && cfg.groupAdmin.enabled === true, owners: Array.isArray(cfg.groupAdmin && cfg.groupAdmin.owners) ? cfg.groupAdmin.owners : [], manageGroup: cfg.groupAdmin && typeof cfg.groupAdmin.manageGroup === 'string' ? cfg.groupAdmin.manageGroup : '', watchJoinRequests: !!(cfg.groupAdmin && cfg.groupAdmin.watchJoinRequests), notifyInGroup: cfg.groupAdmin && cfg.groupAdmin.notifyInGroup !== false },
        }
        fetch(UPDATE, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ patch: patch, expectedRevision: rev, ns: _acctNs || undefined }),
        }).then(function (r) { return r.json().catch(function () { return null }) }).then(function (d) {
          if (d && d.value) {
            var v2 = d.value
            setCfg({
              behavior: v2.behavior || {}, sticker: v2.sticker || {},
              injectRules: Array.isArray(v2.injectRules) ? v2.injectRules : [],
              imageHint: typeof v2.imageHint === 'boolean' ? v2.imageHint : undefined,
              messageReference: v2.messageReference !== false,
              schedule: v2.schedule && Array.isArray(v2.schedule.targets) ? v2.schedule : { targets: [] },
              groupPrompt: typeof v2.groupPrompt === 'string' ? v2.groupPrompt : (typeof cfg.groupPrompt === 'string' ? cfg.groupPrompt : DEFAULT_GROUP_PROMPT),
              enableApprovals: v2.enableApprovals === true,
              approvalTimeoutMs: typeof v2.approvalTimeoutMs === 'number' ? v2.approvalTimeoutMs : 120000,
              outboundMode: (v2.outboundMode === 'detail' || v2.outboundMode === 'passive' || v2.outboundMode === 'silent' || v2.outboundMode === 'nothink' ? v2.outboundMode : 'adaptive'),
              groupAdmin: { enabled: v2.groupAdmin && v2.groupAdmin.enabled === true, owners: Array.isArray(v2.groupAdmin && v2.groupAdmin.owners) ? v2.groupAdmin.owners : [], manageGroup: v2.groupAdmin && typeof v2.groupAdmin.manageGroup === 'string' ? v2.groupAdmin.manageGroup : '', watchJoinRequests: !!(v2.groupAdmin && v2.groupAdmin.watchJoinRequests), notifyInGroup: v2.groupAdmin && v2.groupAdmin.notifyInGroup !== false },
            })
            setRev(d.revision); setMsg('已保存 ✓(live 生效)')
          }
          else if (d && d.error) { setMsg('保存失败: ' + d.error) }
          else { setMsg('保存失败(未知响应)') }
        }).catch(function (e) { setMsg('保存异常: ' + e.message) })
      }
      function save() { doSave(undefined) }
      // 恢复默认守则: 直接把"表情包礼仪"默认文本写回并保存(不需手动粘贴)
      function restoreDefault() { doSave(DEFAULT_GROUP_PROMPT) }

      var gh = gates.bannedGroups || []
      return h('div', { style: { maxWidth: 640 } },
        h('h2', null, 'QQ 机器人设置'),
        h('p', { style: { fontSize: 12, color: '#888' } }, '改完点「保存」立刻生效(不用重启)。看不懂的项放着别动就行;想恢复"不限制"就把数字填 0、勾选取消、列表清空。'),

        h('div', { style: sectionTitle }, '⓪ 群里她要一直记住的守则'),
        h('p', { style: { fontSize: 12, color: '#888' } }, '每轮回复都会带上的一段提醒(所有 QQ 群都生效,不碰你的人格设定)。默认是"表情包礼仪";想让她不主动发图,把这里清空即可(留空=没守则,不会自动填回)。'),
        h('textarea', { className: 'qqs-area',
          style: { ...fullStyle, minHeight: 90 },
          value: sv(cfg.groupPrompt),
          onChange: function (e) { setCfg(function (c) { return { ...c, groupPrompt: e.target.value } }) },
        }),
        h('div', { style: { margin: '0 0 6px' } },
          h('button', { className: 'qqs-btn', style: { padding: '2px 10px', fontSize: 12 }, onClick: restoreDefault }, '恢复默认守则(表情包礼仪)')),

        h('div', { style: sectionTitle }, '① 多久回一次消息'),
        h('p', { style: { fontSize: 12, color: '#888' } }, '控制她回复的速度。全填 0 = 来一条回一条(不限制)。'),
        h('div', { style: boxStyle },
          NumRow({ label: '群里没人 @ 她时,隔几秒才回一次(0=每条都回)', value: cfg.behavior.freeIntervalSec, onChange: function (v) { setBehavior({ freeIntervalSec: v }) } }),
          NumRow({ label: '有人 @ 她时,两次回复至少隔几秒(0=随叫随到)', value: cfg.behavior.mentionIntervalSec, onChange: function (v) { setBehavior({ mentionIntervalSec: v }) } }),
          NumRow({ label: '私聊里隔几秒回一次(0=不限制)', value: cfg.behavior.directIntervalSec, onChange: function (v) { setBehavior({ directIntervalSec: v }) } }),
          h('div', { style: { fontSize: 12, color: '#666', margin: '10px 0 2px' } }, '出站方式(连发消息 QQ 端丢失时切主动):'),          h('div', { style: { display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' } },            ['adaptive', 'detail', 'passive', 'silent', 'nothink'].map(function (m) {              var cur = (cfg.outboundMode || 'adaptive'); if (cur === 'active') cur = 'adaptive';              return h('label', { style: { display: 'inline-flex', gap: 5, alignItems: 'center', fontSize: 12, color: '#333', cursor: 'pointer' } },                h('input', { type: 'radio', name: 'qqs-outbound', checked: cur === m, onChange: function () { setCfg(function (c) { return Object.assign({}, c, { outboundMode: m }) }) } }),                m === 'adaptive' ? '适配主动(推荐默认)' : (m === 'detail' ? '详细主动(连工具调用一起推)' : (m === 'passive' ? '被动(只回最后一句)' : (m === 'silent' ? '完全不出站(静默)' : '完全不思考(QQ入站不唤醒,仅设置页)'))))            })),          h('div', { style: { fontSize: 12, color: '#888' } }, '适配主动=刚收到真人消息时前5条带引用回你, 第6条起自动转独立新消息(连发不被QQ吞); 一段时间没新消息的主动推送(定时等)也走独立消息。被动=始终回你那条(连发约4~5条后被QQ吞)。完全不出站=照常思考但不向QQ发任何回复(AI 可用工具切回)。完全不思考=QQ入站不唤醒AI, 消息只记录(仅本页可开; 唤醒请发 /outmode adaptive)。保存即热更新, 不用重启。'),          h('div', { style: { fontSize: 12, color: '#666', margin: '10px 0 2px' } }, '延迟聚合(另一套机制,和上面冷却不冲突): 她收到消息先等一小会儿, 把连发的话攒一起综合回, 免得只回第一句。'),
          BoolRow({ label: '开启延迟聚合(不勾=回到来一条回一条)', value: dbc.enabled !== false, onChange: function (v) { setBehavior({ debounce: { ...dbc, enabled: v } }) } }),
          NumRow({ label: '对方停口几秒后她才开口(默认3;0=不停顿)', value: dbc.silenceSec != null ? dbc.silenceSec : 3, onChange: function (v) { setBehavior({ debounce: { ...dbc, silenceSec: v } }) } }),
          NumRow({ label: '攒满几条立即开口,不等对方停(默认10)', value: dbc.maxMsgs != null ? dbc.maxMsgs : 10, onChange: function (v) { setBehavior({ debounce: { ...dbc, maxMsgs: v } }) } }),
          BoolRow({ label: '有人 @ 她时也走延迟(不勾=@到秒回)', value: dbc.mentionDelayed !== false, onChange: function (v) { setBehavior({ debounce: { ...dbc, mentionDelayed: v } }) } })),

        h('div', { style: sectionTitle }, '② 发表情包的限制(全默认不限制)'),
        h('p', { style: { fontSize: 12, color: '#888' } }, '防止她聊天时表情包刷屏;下面两项是"她主动发图"时才用——群里很热闹才发,冷清就憋着。不想管就保持全 0,也别勾总开关。'),
        h('div', { style: boxStyle },
          BoolRow({ label: '开启表情包限制(不勾=完全不限制)', value: gates.enabled, onChange: function (v) { setGates({ enabled: v }) } }),
          NumRow({ label: '她一次回复最多带几张图(0=不限)', value: gates.perTurnMax, onChange: function (v) { setGates({ perTurnMax: v }) } }),
          NumRow({ label: '每隔"一小段时间"最多发几张(0=不限)', value: gates.maxPerWindow, onChange: function (v) { setGates({ maxPerWindow: v }) } }),
          NumRow({ label: '上面说的"一小段时间"是多长(秒,如600=10分钟)', value: gates.perWindowSec, onChange: function (v) { setGates({ perWindowSec: v }) } }),
          NumRow({ label: '每个群一天最多发几张表情包(0=不限)', value: gates.dailyBudgetPerGroup, onChange: function (v) { setGates({ dailyBudgetPerGroup: v }) } }),
          NumRow({ label: '同一张图多久内不许重复发(小时,0=不查)', value: gates.dupTTLHours, onChange: function (v) { setGates({ dupTTLHours: v }) } }),
          NumRow({ label: '看"最近"多长时间的聊天来判热闹(3600=最近1小时)', value: gates.activityWindowSec, onChange: function (v) { setGates({ activityWindowSec: v }) } }),
          NumRow({ label: '最近这段时间群消息达到几条,她才肯主动发图(0=不管冷不冷都发)', value: gates.activityMinMsgs, onChange: function (v) { setGates({ activityMinMsgs: v }) } }),
          StrRow({ label: '禁止发图的群(填群ID,逗号分隔;一般不用填)', value: gh.join(','), wide: true, onChange: function (v) { setGates({ bannedGroups: v.split(/[,，]/).map(function (s) { return s.trim() }).filter(Boolean) }) } })),
        h('div', { style: boxStyle },
          BoolRow({ label: '新图自动后台识图打标(会花视觉额度;不勾=全靠人工手动补)', value: !!cfg.sticker.autoTagEnabled, onChange: function (v) { setSticker({ autoTagEnabled: v }) } }),
          StrRow({ label: '视觉引擎命令(高级;留空自动探测)', value: sv(cfg.sticker.visionCli), wide: true, onChange: function (v) { setSticker({ visionCli: v }) } })),

        h('div', { style: sectionTitle }, '③ 自定义小提醒(高级)'),
        h('p', { style: { fontSize: 12, color: '#888' } }, '当群友发的消息满足下面条件,就偷偷给机器人加一条要照做的提醒。比如:勾上"含链接",提醒写"引用前先核实"。'),
        (cfg.injectRules || []).map(function (r, i) {
          return h(RuleEditor, { key: r.id, rule: r, onChange: function (nr) { updRule(i, nr) }, onRemove: rmRule })
        }),
        h('button', { className: 'qqs-btn', onClick: addRule }, '+ 添加一条提醒'),
        h('div', { style: boxStyle },
          BoolRow({ label: '图片消息自动提示 AI 看图(内置兜底; 不勾=不再注入「请把URL传给识图工具」那条)', value: cfg.imageHint !== false, onChange: function (v) { setCfg(function (c) { return { ...c, imageHint: v } }) } }),
          BoolRow({ label: '引用消息(默认开): 入站消息带短消息号(本地台账索引,省token) + 引用消息附原文; AI 用 [rf:短号] 引用对方消息', value: cfg.messageReference !== false, onChange: function (v) { setCfg(function (c) { return { ...c, messageReference: v } }) } })),

        h('div', { style: sectionTitle }, '④ 定时唤醒'),
        h('p', { style: { fontSize: 12, color: '#888' } }, '已合并到「定时任务」页(顶部 tab)一起编辑——到点主动开口的群/人分组,与她答应你的定时提醒,都在那边管理。'),

        h('div', { style: sectionTitle }, '⑤ QQ 远程审批(在 QQ 里放行 dsh 权限申请)'),
        h('p', { style: { fontSize: 12, color: '#888' } }, '机器人的工具要动"工作区外"的东西时,dsh 会申请权限。开启后审批请求直接发到你的 QQ(私聊/群聊看你从哪发起),回 /approve 验证码 放行、/deny 拒绝——只放行这一次,验证码一次性,只有你能批。'),
        h('div', { style: boxStyle },
          BoolRow({ label: '开启 QQ 远程审批(不勾=保持默认审批方式)', value: cfg.enableApprovals === true, onChange: function (v) { setCfg(function (c) { return { ...c, enableApprovals: v } }) } }),
          NumRow({ label: '审批等待秒数(超时自动拒绝;默认120)', value: Math.round((cfg.approvalTimeoutMs || 120000) / 1000), onChange: function (v) { setCfg(function (c) { return { ...c, approvalTimeoutMs: v * 1000 } }) } })),

        h('div', { style: { ...card, margin: '10px 0', padding: '12px 16px' } },
          h('div', { style: { fontWeight: 700, fontSize: 13, marginBottom: 2 } }, '⚙ 群管理基础设置'),
          h('p', { style: { fontSize: 12, color: T.text3, margin: '0 0 6px' } }, '开启后 QQ 会话里可用群管理工具; 踢人/成员列表等官方未开放能力会在下方 Tab 里提示等待公测。'),
          BoolRow({ label: '开启 QQ 群管理(不勾=群管理工具不可用)', value: cfg.groupAdmin && cfg.groupAdmin.enabled === true, onChange: function (v) { setGroupAdmin({ enabled: v }) } }),
          StrRow({ label: '允许操作的主人 openid(逗号分隔,可留空=不校验)', value: (cfg.groupAdmin && Array.isArray(cfg.groupAdmin.owners) ? cfg.groupAdmin.owners : []).join(','), wide: true, onChange: function (v) { setGroupAdmin({ owners: v.split(/[,，]/).map(function (s) { return s.trim() }).filter(Boolean) }) } }),
          StrRow({ label: '对话内默认管理群 group_openid(web 对话时群工具用它; QQ 群会话自动用当前群)', value: (cfg.groupAdmin && typeof cfg.groupAdmin.manageGroup === 'string' ? cfg.groupAdmin.manageGroup : ''), wide: true, onChange: function (v) { setGroupAdmin({ manageGroup: v.trim() }) } }),
          BoolRow({ label: '实时接收"入群申请"事件并自动提醒(勾选后需重启才生效)', value: !!(cfg.groupAdmin && cfg.groupAdmin.watchJoinRequests), onChange: function (v) { setGroupAdmin({ watchJoinRequests: v }) } }),
          BoolRow({ label: '收到入群申请时在该群内发提醒消息', value: !(cfg.groupAdmin && cfg.groupAdmin.notifyInGroup === false), onChange: function (v) { setGroupAdmin({ notifyInGroup: v }) } })),
        h(GroupAdminPanel, { key: 'ga-' + (_acctNs || 'main'), ns: _acctNs || undefined }),

        h('div', { style: { margin: '12px 0' } },
          h('button', { className: 'qqs-btn', style: { marginRight: 8 }, onClick: save }, '保存'),
          h('button', { className: 'qqs-btn', onClick: load }, '放弃修改(重新读取)')),
        msg ? h('p', { style: { fontSize: 13, color: '#2f9e44' } }, msg) : null,
        close ? h('button', { className: 'qqs-btn', onClick: close, style: { float: 'right' } }, '完成') : null)
    }

        // ── ⑥ QQ 群管理(单开大卡片; P3+ 设计系统版: 横排 Tab + 状态条 + 表格 + 空状态 + 预留接口位) ──
    // 能力就绪度: 官方未开放位保留(红条+行动), 不置灰糊弄; 业务名词做 Tab 骨架。
    var GROUP_TABS = [
      { key: 'send', label: '发消息', open: true },
      { key: 'join', label: '入群审批', open: true },
      { key: 'mute', label: '禁言', open: true },
      { key: 'members', label: '成员信息', open: false, gateHuman: '获取群成员列表: 官方尚未开放(内邀中), 等待公测后自动可用' },
      { key: 'blacklist', label: '黑名单', open: false, gateHuman: '群黑名单: 官方接口尚未开放, 等待公测后自动可用' },
    ]
    function GroupAdminPanel(props) {
      var nsq = props && props.ns ? '?ns=' + encodeURIComponent(props.ns) : ''
      var [accts, setAccts] = useState(null)
      var [gid, setGid] = useState('')
      var [tab, setTab] = useState('join')
      var [joins, setJoins] = useState(null)
      var [mute, setMute] = useState(null)
      var [msg, setMsg] = useState('')
      var [busy, setBusy] = useState('')
      var [bindGid, setBindGid] = useState('')
      var [bindName, setBindName] = useState('')
      var [members, setMembers] = useState(null)
      var [muteSecs, setMuteSecs] = useState('60')
      var [muteTarget, setMuteTarget] = useState('')
      var [sendText, setSendText] = useState('')

      function loadMembers() {
        if (!gid) return
        fetch('/api/qqbot-settings/group/members_local' + nsq + (nsq ? '&' : '?') + 'gid=' + encodeURIComponent(gid)).then(function (r) { return r.json() }).then(function (d) {
          setMembers(d && d.ok ? (d.members || []) : [])
        }).catch(function () { setMembers([]) })
      }

      function loadAccounts() {
        fetch('/api/qqbot-settings/group/accounts' + nsq).then(function (r) { return r.json() }).then(function (d) {
          if (d && d.error) { setMsg('群面板: ' + d.error); setAccts([]); return }
          var list = (d && Array.isArray(d.groups) ? d.groups : []).map(function (g) { return { gid: g.gid, name: g.name || '', from: g.from || '' } })
          setAccts(list)
          if (list.length && !gid) setGid(list[0].gid)
          else if (list.length === 0) { setJoins(null); setMute(null) }
        }).catch(function (e) { setMsg('群列表加载失败: ' + e.message) })
      }
      function refresh() {
        if (!gid) return
        if (tab === 'join') {
          fetch('/api/qqbot-settings/group/join_requests' + nsq + (nsq ? '&' : '?') + 'gid=' + encodeURIComponent(gid)).then(function (r) { return r.json() }).then(function (d) {
            if (d && d.ok) setJoins(d); else setMsg((d && d.err && d.err.human) || '申请列表加载失败')
          }).catch(function (e) { setMsg('申请列表加载异常: ' + e.message) })
        } else if (tab === 'mute') {
          fetch('/api/qqbot-settings/group/mute_state' + nsq + (nsq ? '&' : '?') + 'gid=' + encodeURIComponent(gid)).then(function (r) { return r.json() }).then(function (d) {
            if (d && d.ok) setMute(d); else setMsg((d && d.err && d.err.human) || '禁言状态加载失败')
          }).catch(function (e) { setMsg('禁言状态加载异常: ' + e.message) })
        }
      }
      useEffect(function () { loadAccounts() }, [])
      useEffect(function () { refresh(); loadMembers() }, [gid, tab])

      function doApprove(mid, op) {
        var reason = op === 'decline' ? window.prompt('拒绝理由(可留空)') : '-'
        if (op === 'decline' && reason === null) return
        setBusy('approve-' + mid)
        fetch('/api/qqbot-settings/group/approve', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify(Object.assign({ gid: gid, member_openid: mid, op: op, reason: reason || '' }, props.ns ? { ns: props.ns } : {})),
        }).then(function (r) { return r.json() }).then(function (d) {
          setBusy('')
          setMsg((d && d.msg) || (d && d.err && d.err.human) || '审批失败')
          refresh()
        }).catch(function (e) { setBusy(''); setMsg('审批异常: ' + e.message) })
      }
      function doMute(mid, action, seconds) {
        var secs = action === 'mute' ? Math.round(Number(seconds || 600)) : 0
        setBusy('mute-' + mid)
        fetch('/api/qqbot-settings/group/mute', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify(Object.assign({ gid: gid, member_openid: mid, action: action, seconds: secs }, props.ns ? { ns: props.ns } : {})),
        }).then(function (r) { return r.json() }).then(function (d) {
          setBusy('')
          setMsg((d && d.msg) || (d && d.err && d.err.human) || '操作失败')
          refresh()
        }).catch(function (e) { setBusy(''); setMsg('禁言异常: ' + e.message) })
      }
      function doBind() {
        var g = bindGid.trim()
        if (!g) { setMsg('先粘贴 group_openid'); return }
        fetch('/api/qqbot-settings/group/bind', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify(Object.assign({ gid: g, name: bindName.trim() }, props.ns ? { ns: props.ns } : {})),
        }).then(function (r) { return r.json() }).then(function (d) {
          if (d && d.ok) { setMsg('已登记群 ✓'); setBindGid(''); setBindName(''); loadAccounts() }
          else setMsg((d && d.error) || '绑定失败')
        }).catch(function (e) { setMsg('绑定异常: ' + e.message) })
      }
      function doSend() {
        var t = sendText.trim()
        if (!t) { setMsg('先输入要发送的内容'); return }
        setBusy('send')
        fetch('/api/qqbot-settings/group/send', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify(Object.assign({ gid: gid, text: t }, props.ns ? { ns: props.ns } : {})),
        }).then(function (r) { return r.json() }).then(function (d) {
          setBusy('')
          setMsg((d && d.msg) || (d && d.err && d.err.human) || (d && d.error) || '发送结果未知')
          if (d && d.ok) setSendText('')
        }).catch(function (e) { setBusy(''); setMsg('发送异常: ' + e.message) })
      }

      var curTabMeta = null
      GROUP_TABS.forEach(function (t) { if (t.key === tab) curTabMeta = t })
      var curGroup = null
      ;(accts || []).forEach(function (a) { if (a.gid === gid) curGroup = a })
      var groupSelName = (curGroup && curGroup.name) ? curGroup.name : ''
      var groupSel = accts === null ? h('span', { style: { fontSize: T.fsSm, color: T.text3 } }, '群列表加载中…')
        : accts.length === 0 ? h('span', { style: { fontSize: T.fsSm, color: T.warn } }, '暂无群(事件累积/下方登记后出现)')
          : h('select', { className: 'qqs-inp', style: { padding: '3px 8px', maxWidth: 320, border: '1px solid ' + T.border, borderRadius: T.radius }, value: gid, onChange: function (e) { setGid(e.target.value); setMsg('') } },
            accts.map(function (a) {
              return h('option', { key: a.gid, value: a.gid }, (a.name ? a.name + ' · ' : '') + a.gid.slice(0, 12) + '…' + (a.from ? ' [' + a.from + ']' : ''))
            }))

      var joinCols = [
        { key: 'username', title: '昵称', width: '18%', render: function (v, r) { return h('span', { style: { fontWeight: 600 } }, v || '(未知)') } },
        { key: 'source', title: '来源', width: '10%', render: function (v, r) { return h('span', { style: { color: T.text2 } }, v || '-') } },
        { key: 'verify', title: '验证消息', render: function (v, r) { return h('span', { style: { color: T.text2 } }, v || '-') } },
        { key: 'risk', title: '风险', width: '18%', render: function (v, r) { return v ? h('span', { style: { color: T.danger } }, '⚠ ' + v) : h('span', { style: { color: T.text3 } }, '-') } },
        { key: 'op', title: '操作', width: '20%', render: function (v, r) {
          var busying = busy === 'approve-' + r.member_openid
          return h('span', { style: { display: 'inline-flex', gap: 6 } },
            h(SButton, { variant: 'primary', size: 'sm', disabled: !!busy, onClick: function () { doApprove(r.member_openid, 'approve') } }, busying ? '处理中…' : '通过'),
            h(SButton, { variant: 'danger', size: 'sm', disabled: !!busy, onClick: function () { doApprove(r.member_openid, 'decline') } }, '拒绝'))
        } },
      ]
      var joinRows = ((joins && joins.ok && joins.list) || []).map(function (j) {
        return {
          username: j.username || '(未知昵称)',
          source: j.apply_source === 'invited' ? '被邀请' : '主动申请',
          verify: j.verify_human || (j.verify_info && j.verify_info.verify_message) || (j.verify_info && j.verify_info.method) || '',
          risk: j.risk_tips || '',
          member_openid: j.member_openid,
        }
      })

      var muteMode = (mute && mute.data && mute.data.global_rule && mute.data.global_rule.mode) || 'none'
      var muteCols = [
        { key: 'username', title: '成员', width: '30%', render: function (v, r) { return h('span', { style: { fontWeight: 600 } }, v || String(r.member_openid).slice(0, 12)) } },
        { key: 'expire', title: '禁言至', render: function (v) { return h('span', { style: { color: T.text2 } }, v || '?') } },
        { key: 'op', title: '操作', width: '18%', render: function (v, r) {
          var busying = busy === 'mute-' + r.member_openid
          return h(SButton, { variant: 'ghost', size: 'sm', disabled: !!busy, onClick: function () { doMute(r.member_openid, 'unmute') } }, busying ? '处理中…' : '解除')
        } },
      ]
      var muteRows = (((mute && mute.data && mute.data.members) || [])).map(function (m) { return { username: m.username || '', member_openid: m.member_openid, expire: m.mute_expire_at || '' } })

      var body = null
      if (curTabMeta && curTabMeta.open === false) {
        body = h('div', null,
          h(StatusBar, { tone: 'danger', action: { label: '去开放平台申请', onClick: function () { window.open('https://q.qq.com', '_blank') } } }, curTabMeta.gateHuman || '该能力官方尚未开放'),
          h('div', { style: { border: '1px dashed ' + T.border, borderRadius: T.radius, padding: '24px', textAlign: 'center', color: T.text3, fontSize: T.fsSm } },
            '此功能位已预留 —— 官方开放接口后此处自动点亮, 无需等待插件更新'))
      } else if (!gid) {
        body = h(Empty, { icon: '👥', text: '先选择或登记一个群, 再查看/操作' })
      } else if (tab === 'send') {
        // 发消息: 以机器人身份直接向目标群发文本(面板=主人直发)
        body = h('div', null,
          h(StatusBar, { tone: 'info' }, '以机器人身份向「' + (groupSelName) + '」发消息 —— 内容会以 bot 名义出现在群里。'),
          h('textarea', { className: 'qqs-area', style: { width: '100%', minHeight: 90, marginTop: 8 }, placeholder: '输入要发的消息…(@某人 用 <@对方openid> 无斜杠 或 <qqbot-at-user id="对方openid" />)', value: sendText, onChange: function (e) { setSendText(e.target.value) } }),
          h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 } },
            h(SButton, { variant: 'primary', disabled: busy === 'send', onClick: doSend }, busy === 'send' ? '发送中…' : '🚀 发送到群'),
            h('span', { style: { fontSize: T.fsSm, color: T.text3 } }, '已输 ' + sendText.length + '/2000 字')))
      } else if (tab === 'join') {
        body = joins === null ? h(Empty, { icon: '⏳', text: '加载中…' })
          : h('div', null,
            h(StatusBar, { tone: 'info' }, '数据来自 QQ 官方接口; 机器人需为群管理员。通过/拒绝将直接生效并写入审计日志。'),
            h(DataTable, { cols: joinCols, rows: joinRows, emptyText: '当前没有待审批的入群申请' }))
      } else if (tab === 'mute') {
        // 禁言页: ①选人禁言(本地成员清单) ②正在禁言中的成员(官方状态)
        var pickList = members === null ? h(Empty, { icon: '⏳', text: '加载成员中…' })
          : members.length === 0 ? h('div', { style: { border: '1px dashed ' + T.border, borderRadius: T.radius, padding: '12px', textAlign: 'center', color: T.text3, fontSize: T.fsSm } },
              '本地暂无成员记录 —— 让群友在群里说句话, 机器人就能记住他们, 之后这里可直接选人禁言(官方成员列表未开放)')
          : h('div', { style: { maxHeight: 260, overflowY: 'auto', border: '1px solid ' + T.border, borderRadius: T.radius } },
              members.map(function (m) {
                var busying = busy === 'mute-' + m.mid
                return h('div', { key: m.mid, style: { display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px', borderBottom: '1px solid ' + T.borderLight, fontSize: T.fsSm } },
                  h('span', { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, (m.name || '(未知名)') + ' · ' + m.mid.slice(0, 10) + '…'),
                  h('input', { className: 'qqs-inp', style: { width: 70, padding: '1px 6px', border: '1px solid ' + T.border, borderRadius: T.radius }, type: 'number', min: 1, defaultValue: muteSecs, onChange: function (e) { setMuteSecs(e.target.value) } }),
                  h('span', { style: { color: T.text3 } }, '分钟'),
                  h(SButton, { variant: 'danger', size: 'sm', disabled: !!busy, onClick: function () { doMute(m.mid, 'mute', Number(muteSecs || 60) * 60) } }, busying ? '处理中…' : '禁言'))
              }))
        body = mute === null ? h(Empty, { icon: '⏳', text: '加载中…' })
          : h('div', null,
            h('div', { style: { fontWeight: 700, fontSize: 13, margin: '10px 0 4px' } }, '① 选择成员禁言'),
            pickList,
            h('div', { style: { fontWeight: 700, fontSize: 13, margin: '14px 0 4px' } }, '② 正在禁言中(官方状态)'),
            h(StatusBar, { tone: 'info' }, '全员禁言: ' + (muteMode === 'always' ? '常开' : muteMode === 'schedule' ? '定时' : '关闭') + ' —— 只能操作普通成员, 群主/管理员不可禁。'),
            h(DataTable, { cols: muteCols, rows: muteRows, emptyText: '没有正在禁言的成员' }))
      } else if (tab === 'members') {
        // 成员信息: 红条(官方未开放)+ 本地兜底名单(见到的发言者)
        var memRows = (members || []).map(function (m) { return { name: m.name || '(未知名)', mid: m.mid, seen: new Date(m.lastSeen).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) } })
        var memCols = [
          { key: 'name', title: '昵称', width: '24%' },
          { key: 'mid', title: '成员 ID', render: function (v) { return h('span', { style: { color: T.text2, wordBreak: 'break-all' } }, v) } },
          { key: 'seen', title: '最近发言', width: '22%', render: function (v) { return h('span', { style: { color: T.text3 } }, v) } },
        ]
        body = h('div', null,
          h(StatusBar, { tone: 'danger', action: { label: '去开放平台申请', onClick: function () { window.open('https://q.qq.com', '_blank') } } }, '官方"群成员列表"接口尚未开放 —— 下方为本地兜底名单(机器人见过的发言者), 仅用于帮你认人。'),
          h('div', { style: { fontWeight: 700, fontSize: 13, margin: '10px 0 4px' } }, '本地成员清单(机器人见过的)'),
          h(DataTable, { cols: memCols, rows: memRows, emptyText: '暂无记录 —— 群友发言后自动出现' }))
      }

      return h('div', { style: { ...card, padding: '4px 0 12px', margin: '12px 0', overflow: 'hidden' } },
        h('div', { style: { padding: '12px 16px', borderBottom: '1px solid ' + T.border, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' } },
          h('span', { style: { fontSize: T.fsTitle, fontWeight: 700 } }, '🛡 群管理'),
          h('span', { style: { fontSize: T.fsSm, color: T.text3 } }, '直连 QQ 官方, 面板操作 = 主人直发'),
          h('span', { style: { flex: 1 } }),
          h('span', { style: { fontSize: T.fsSm, color: T.text2 } }, '目标群'),
          groupSel,
          h(SButton, { variant: 'ghost', size: 'sm', onClick: refresh }, '刷新')),
        h('div', { style: { padding: '0 16px' } },
          h(TabBar, { items: GROUP_TABS.map(function (t) { return { key: t.key, label: t.label + (t.open ? '' : '(待开放)'), badge: t.key === 'join' ? joinRows.length : 0 } }), value: tab, onChange: function (k) { setTab(k); setMsg('') } })),
        h('div', { style: { padding: '0 16px' } }, body),
        h('div', { style: { margin: '12px 16px 0', borderTop: '1px solid ' + T.borderLight, paddingTop: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
          h('span', { style: { fontSize: T.fsSm, color: T.text2 } }, '登记群(官方无"我的群列表", 手动粘贴):'),
          h('input', { className: 'qqs-inp', style: { width: 200, padding: '3px 8px', border: '1px solid ' + T.border, borderRadius: T.radius }, placeholder: 'group_openid', value: bindGid, onChange: function (e) { setBindGid(e.target.value) } }),
          h('input', { className: 'qqs-inp', style: { width: 100, padding: '3px 8px', border: '1px solid ' + T.border, borderRadius: T.radius }, placeholder: '备注(可选)', value: bindName, onChange: function (e) { setBindName(e.target.value) } }),
          h(SButton, { variant: 'primary', size: 'sm', onClick: doBind }, '绑定'),
          msg ? h('span', { style: { fontSize: T.fsSm, color: T.success } }, msg) : null))
    }

    var API_LIST = '/api/qqbot-settings/stickers'
    var API_IMG = '/api/qqbot-settings/sticker-img?id='
    var API_BATCH = '/api/qqbot-settings/stickers/batch'
    var API_IMPORT = '/api/qqbot-settings/stickers/import'
    var LAYER_LABEL = { candidate: '待整理', library: '收藏', trash: '回收站' }

    function Lightbox(props) {
      var it = props.item || {}
      var lbDD = props.storeDir || ''
      var [tagsText, setTagsText] = useState((it.tags || []).join('，'))
      var [desc, setDesc] = useState(it.desc || '')
      var [saved, setSaved] = useState('')
      function doBatch(op, extra) {
        fetch(API_BATCH, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify(Object.assign({ op: op, ids: [it.id], dataDir: lbDD || undefined }, extra || {})),
        }).then(function (r) { return r.json() }).then(function () { setSaved(op === 'tag' ? '已保存 ✓' : (op === 'promote' ? '已移入收藏 ✓' : '已送回收站 ✓')); props.onChanged && props.onChanged() }).catch(function (e) { setSaved('失败:' + e.message) })
      }
      return h('div', { style: { position: 'fixed', inset: 0, background: '#000c', zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center' }, onClick: function () { props.onClose() } },
        h('div', { className: 'qqs-modal', style: { background: '#22252e', borderRadius: 12, padding: 14, maxWidth: 560, width: '92%', maxHeight: '88vh', overflow: 'auto' }, onClick: function (e) { e.stopPropagation() } },
          h('img', { src: API_IMG + encodeURIComponent(it.id) + (lbDD ? '&dataDir=' + encodeURIComponent(lbDD) : ''), style: { maxWidth: '100%', maxHeight: '46vh', borderRadius: 8, display: 'block', margin: '0 auto', objectFit: 'contain' } }),
          h('p', { style: { fontSize: 12, color: '#999' } }, '图号 ' + it.id.slice(0, 8) + ' · ' + (LAYER_LABEL[it.layer] || it.layer) + ' · 用过 ' + (it.useCount || 0) + ' 次'),
          h('div', { style: { fontSize: 13, margin: '4px 0' } }, '标签(逗号或空格分开都行,自动去重):'),
          h('input', { className: 'qqs-inp', style: { width: '100%', padding: '4px 8px' }, value: tagsText, onChange: function (e) { setTagsText(e.target.value) } }),
          h('div', { style: { fontSize: 13, margin: '6px 0 2px' } }, '描述(一句话说明画面和适合场合):'),
          h('textarea', { className: 'qqs-area', style: { width: '100%', minHeight: 54 }, value: desc, onChange: function (e) { setDesc(e.target.value) } }),
          h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', margin: '6px 0', fontSize: 12, color: '#aaa' } },
            h('span', { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', direction: 'rtl', textAlign: 'left' } }, it.path || ''),
            h('button', { className: 'qqs-btn', style: { padding: '2px 8px', fontSize: 12 }, onClick: function () { try { navigator.clipboard.writeText(it.path || '').then(function () { setSaved('原路径已复制 ✓') }).catch(function () { setSaved('复制失败') }) } catch (e2) { setSaved('复制失败:' + e2.message) } } }, '复制原路径')),
          h('div', { style: { marginTop: 8, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' } },
            h('button', { className: 'qqs-btn', onClick: function () { doBatch('tag', { tags: tagsText.split(/[,，\s]+/).map(function (s) { return s.trim() }).filter(Boolean), desc: desc }) } }, '保存'),
            it.layer !== 'library' ? h('button', { className: 'qqs-btn', onClick: function () { doBatch('promote') } }, '移入收藏') : null,
            it.layer !== 'trash' ? h('button', { className: 'qqs-btn', onClick: function () { doBatch('trash') } }, '送回收站') : null,
            it.layer === 'trash' ? h('button', { className: 'qqs-btn', onClick: function () { doBatch('restore') } }, '恢复') : null,
            saved ? h('span', { style: { fontSize: 12, color: '#2f9e44' } }, saved) : null,
            h('button', { className: 'qqs-btn', onClick: function () { props.onClose() } }, '关闭'))))
    }

    function ImportPanel(props) {
      var ipDD = props.storeDir || ''
      var [text, setText] = useState('')
      var [fileMsg, setFileMsg] = useState('')
      var [result, setResult] = useState('')
      var fileInput = React.useRef(null)
      function doImport(extra) {
        setResult('导入中…')
        fetch(API_IMPORT, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(Object.assign({}, extra, ipDD ? { dataDir: ipDD } : {})) })
          .then(function (r) { return r.json() }).then(function (d) {
            var rs = (d && d.results) || []
            var ok = 0, dup = 0, err = 0, errList = []
            rs.forEach(function (x) { if (x.status === 'new') ok += 1; else if (x.status === 'dup') dup += 1; else { err += 1; if (errList.length < 5) errList.push(x.ref) } })
            setResult('完成: 新增 ' + ok + ' 张, 已有跳过 ' + dup + ' 张' + (err ? ', 失败 ' + err + ' 张(' + errList.join('; ') + ')' : ''))
          }).catch(function (e) { setResult('失败:' + e.message) })
      }
      function pickFiles() {
        var files = fileInput.current && fileInput.current.files ? Array.from(fileInput.current.files).slice(0, 20) : []
        if (!files.length) return
        setFileMsg('读取中 ' + files.length + ' 个文件…')
        var reads = files.map(function (f) {
          return new Promise(function (res) {
            var rd = new FileReader()
            rd.onload = function () {
              var b64 = String(rd.result || '').split(',')[1] || ''
              res({ name: f.name, dataBase64: b64 })
            }
            rd.onerror = function () { res(null) }
            rd.readAsDataURL(f)
          })
        })
        Promise.all(reads).then(function (list) {
          var filesArr = list.filter(Boolean)
          setFileMsg('')
          doImport({ files: filesArr })
        })
      }
      return h('div', { style: { position: 'fixed', inset: 0, background: '#000c', zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center' }, onClick: function () { props.onClose() } },
        h('div', { className: 'qqs-modal', style: { background: '#22252e', borderRadius: 12, padding: 14, maxWidth: 520, width: '92%' }, onClick: function (e) { e.stopPropagation() } },
          h('h3', { style: { marginTop: 0 } }, '导入表情包'),
          h('div', null,
            h('input', { className: 'qqs-inp', ref: fileInput, type: 'file', accept: 'image/*', multiple: true }),
            h('button', { className: 'qqs-btn', style: { marginLeft: 8 }, onClick: pickFiles }, '上传所选图片')),
          h('p', { style: { fontSize: 12, color: '#999' } }, '或粘贴每行一个：图片URL 或 电脑上的图片路径'),
          h('textarea', { className: 'qqs-area', style: { width: '100%', minHeight: 70 }, value: text, placeholder: 'https://… 或 D:\\…\\xx.jpg', onChange: function (e) { setText(e.target.value) } }),
          h('div', { style: { margin: '6px 0' } },
            h('button', { className: 'qqs-btn', onClick: function () {
              var lines = text.split('\n').map(function (s) { return s.trim() }).filter(Boolean)
              var urls = lines.filter(function (x) { return /^https?:\/\//i.test(x) })
              var paths = lines.filter(function (x) { return !/^https?:\/\//i.test(x) })
              doImport({ urls: urls, paths: paths })
            } }, '导入粘贴的内容')),
          fileMsg ? h('p', { style: { fontSize: 12 } }, fileMsg) : null,
          result ? h('p', { style: { fontSize: 13, color: '#2f9e44' } }, result) : null,
          h('div', { style: { textAlign: 'right', marginTop: 8 } }, h('button', { className: 'qqs-btn', onClick: function () { props.onClose() } }, '关闭'))))
    }

    function GalleryPage(props) {
      // 多账号: 图库按当前账号 dataDir(各号各库)
      var DD = props && props.acct && props.acct.dataDir ? String(props.acct.dataDir) : ''
      var [items, setItems] = useState([])
      var [layer, setLayer] = useState('')
      var [untagged, setUntagged] = useState(false)
      var [q, setQ] = useState('')
      var [sel, setSel] = useState([])
      var [box, setBox] = useState(null)
      var [imp, setImp] = useState(false)
      var gridRef = React.useRef(null)
      var suppressRef = React.useRef(false)
      var [mq, setMq] = useState(null)
      var selDownRef = React.useRef(false)

      function onGridDown(e) {
        if (e.button !== 0) return
        if (selDownRef.current) return
        selDownRef.current = true
        try { if (e.target && e.target.closest && e.target.closest('input,textarea,button,select,label,a,[data-sel-card]')) { selDownRef.current = false; return } } catch (e2) {}
        var sx = e.clientX, sy = e.clientY, moved = false
        function move(ev) {
          var dx = ev.clientX - sx, dy = ev.clientY - sy
          if (!moved && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) moved = true
          if (moved) setMq({ x0: Math.min(sx, ev.clientX), y0: Math.min(sy, ev.clientY), x1: Math.max(sx, ev.clientX), y1: Math.max(sy, ev.clientY) })
        }
        function up(ev) {
          window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); setMq(null); selDownRef.current = false
          if (moved && gridRef.current) {
            suppressRef.current = true
            var r = { x0: Math.min(sx, ev.clientX), y0: Math.min(sy, ev.clientY), x1: Math.max(sx, ev.clientX), y1: Math.max(sy, ev.clientY) }
            var hits = []
            Array.prototype.forEach.call(gridRef.current.children, function (el, i) {
              var b = el.getBoundingClientRect()
              var cx = b.left + b.width / 2, cy = b.top + b.height / 2
              if (cx >= r.x0 && cx <= r.x1 && cy >= r.y0 && cy <= r.y1) { var it = items[i]; if (it) hits.push(it.id) }
            })
            if (hits.length) setSel(function (s) { return ev.shiftKey ? Array.from(new Set(s.concat(hits))) : hits })
            setTimeout(function () { suppressRef.current = false }, 80)
          }
        }
        window.addEventListener('mousemove', move); window.addEventListener('mouseup', up)
      }
      var [msg, setMsg] = useState('')

      function load(quiet) {
        // 回收站层必须带 includeTrash=1, 否则 queryAll 默认滤掉 trash(既有坑: 回收站一直显示空)
        var url = API_LIST + '?layer=' + encodeURIComponent(layer) + (layer === 'trash' ? '&includeTrash=1' : '') + (untagged ? '&untagged=1' : '') + '&q=' + encodeURIComponent(q) + (DD ? '&dataDir=' + encodeURIComponent(DD) : '')
        fetch(url).then(function (r) { return r.json() }).then(function (d) {
          if (d && Array.isArray(d.items)) {
            setItems(d.items)
            if (!quiet) setSel([])
          }
        }).catch(function (e) { if (!quiet) setMsg('加载失败:' + e.message) })
      }
      useEffect(function () { load(true) }, [layer, untagged, q])
      // 自动刷新: 后台机器人持续收藏/改动时, 页面每 6 秒同步一次(不打断勾选)
      useEffect(function () {
        var t = setInterval(function () { load(true) }, 6000)
        return function () { clearInterval(t) }
      }, [layer, untagged, q])

      function toggle(id) { setSel(function (s) { return s.includes(id) ? s.filter(function (x) { return x !== id }) : s.concat(id) }) }
      function batch(op, extra) {
        if (!sel.length) return
        fetch(API_BATCH, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify(Object.assign({ op: op, ids: sel, dataDir: DD || undefined }, extra || {})),
        }).then(function (r) { return r.json() }).then(function (d) {
          setMsg((d && d.total !== undefined ? '已处理 ' + d.ok + '/' + d.total : '完成') + ' ✓')
          load()
        }).catch(function (e) { setMsg('操作失败:' + e.message) })
      }

      var pills = [['', '全部'], ['candidate', '待整理'], ['library', '收藏'], ['trash', '回收站']]
      return h('div', { className: 'qqs-panel', onMouseDown: onGridDown, style: { maxWidth: 1080, width: '100%', userSelect: 'none' } },
        h('h2', null, '表情包图库'),
        h('div', { className: 'qqs-toolbar', style: {} },
          pills.map(function (p) {
            return h('button', { className: 'qqs-btn', key: p[0], style: { padding: '3px 10px', fontWeight: layer === p[0] ? 700 : 400 }, onClick: function () { setLayer(p[0]) } }, p[1])
          }),
          h('input', { className: 'qqs-inp', placeholder: '搜标签/描述…', value: q, style: { flex: 1, minWidth: 140 }, onChange: function (e) { setQ(e.target.value) } }),
          h('label', { style: { fontSize: 13, whiteSpace: 'nowrap' } }, h('input', { className: 'qqs-inp', type: 'checkbox', className: 'qqs-cb', checked: untagged, onChange: function (e) { setUntagged(e.target.checked) } }), ' 只看没打标的'),
          h('button', { className: 'qqs-btn', onClick: function () { setImp(true) } }, '导入'),
          h('button', { className: 'qqs-btn', onClick: load }, '刷新')),
        h('p', { style: { fontSize: 12, color: '#888' } }, '共 ' + items.length + ' 张。点图看大图并编辑标签/描述;勾选后底部批量操作。'),
        items.length === 0 ? h('p', { style: { color: '#888', padding: 20, textAlign: 'center' } }, '这里还没有图' + (untagged ? '(没有未打标的图了 🎉)' : '，点右上角「导入」或等群里发图自动收藏')) : null,
        h('div', { ref: gridRef, onMouseDown: onGridDown, style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(104px,1fr))', gap: 14, padding: 14, userSelect: 'none', cursor: 'crosshair', minHeight: 120 } },
          items.map(function (it) {
            var on = sel.includes(it.id)
            return h('div', { key: it.id, 'data-sel-card': true, className: 'qqs-card', style: { position: 'relative', border: '1px solid ' + (on ? '#2f9e44' : '#8883'), borderRadius: 8, overflow: 'hidden', cursor: 'pointer' }, onClick: function () { if (suppressRef.current) return; setBox(it) } },
              h('img', { src: API_IMG + encodeURIComponent(it.id) + (DD ? '&dataDir=' + encodeURIComponent(DD) : ''), style: { width: '100%', height: 104, objectFit: 'cover', display: 'block' } }),
              h('input', { className: 'qqs-inp', type: 'checkbox', className: 'qqs-cb', checked: on, style: { position: 'absolute', left: 4, top: 4 }, onClick: function (e) { e.stopPropagation(); toggle(it.id) } }),
              it.tags && it.tags.length ? h('span', { style: { position: 'absolute', left: 4, bottom: 2, fontSize: 10, color: '#fff', background: '#0009', borderRadius: 4, padding: '0 4px', maxWidth: '80%', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' } }, it.tags[0]) : null,
              it.layer === 'library' ? h('span', { style: { position: 'absolute', right: 4, bottom: 2, fontSize: 10, color: '#ffd43b' } }, '★') : null,
              it.layer === 'trash' ? h('span', { style: { position: 'absolute', right: 4, bottom: 2, fontSize: 10, color: '#ffa94d' } }, '回收站') : null)
          })),
        h('div', { style: { height: 120, cursor: 'crosshair', userSelect: 'none' } }),
        sel.length ? h('div', { style: { position: 'sticky', bottom: 8, marginTop: 10, background: 'rgba(255,255,255,.86)', border: '1px solid #00000030', borderRadius: 12, padding: '8px 12px', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', boxShadow: '0 6px 22px rgba(0,0,0,.18)', backdropFilter: 'blur(4px)' } },
          h('span', { style: { fontWeight: 800, color: '#171a21' } }, '已选 ' + sel.length + ' 张'),
          layer !== 'trash' ? h('button', { onClick: function () { batch('promote') }, style: { font: 'inherit', cursor: 'pointer', padding: '4px 12px', borderRadius: 9, border: '1px solid #2f9e4499', background: 'rgba(47,158,68,.12)', color: '#1d7a31', fontWeight: 700, fontSize: 13 } }, '移入收藏 ★') : null,
          layer !== 'trash' ? h('button', { onClick: function () { batch('trash') }, style: { font: 'inherit', cursor: 'pointer', padding: '4px 12px', borderRadius: 9, border: '1px solid #e8590c99', background: 'rgba(232,89,12,.12)', color: '#c2450a', fontWeight: 700, fontSize: 13 } }, '送回收站') : null,
          layer === 'trash' ? h('button', { onClick: function () { batch('restore') }, style: { font: 'inherit', cursor: 'pointer', padding: '4px 12px', borderRadius: 9, border: '1px solid #2f9e4499', background: 'rgba(47,158,68,.12)', color: '#1d7a31', fontWeight: 700, fontSize: 13 } }, '恢复') : null,
          h('button', { onClick: function () { setSel([]) }, style: { font: 'inherit', cursor: 'pointer', padding: '4px 12px', borderRadius: 9, border: '1px solid #00000030', background: 'rgba(255,255,255,.7)', color: '#444', fontWeight: 600, fontSize: 13 } }, '取消')) : null,
        mq ? h('div', { style: { position: 'fixed', left: mq.x0, top: mq.y0, width: Math.max(0, mq.x1 - mq.x0), height: Math.max(0, mq.y1 - mq.y0), border: '1px dashed #5b9dff', background: '#5b9dff22', pointerEvents: 'none', zIndex: 500 } }) : null,
        msg ? h('p', { style: { fontSize: 13, color: '#2f9e44' } }, msg) : null,
        box ? h(Lightbox, { item: box, storeDir: DD || undefined, onClose: function () { setBox(null); load() }, onChanged: load }) : null,
        imp ? h(ImportPanel, { storeDir: DD || undefined, onClose: function () { setImp(false); load() } }) : null)
    }

    // ── 定时任务页(管理 AI 在 QQ 会话里建的定时任务: 一次性/每天) ──
    var API_TIMERS = '/api/qqbot-settings/timers'
    function fmtWhen(job) {
      if (job.kind === 'daily') return '每天 ' + (job.atTime || '??:??')
      if (job.kind === 'once' && job.dueAt) {
        var d = new Date(job.dueAt)
        var p2 = function (n) { return n < 10 ? '0' + n : '' + n }
        return '一次性 · ' + d.getFullYear() + '/' + p2(d.getMonth() + 1) + '/' + p2(d.getDate()) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes())
      }
      return job.kind === 'once' ? '一次性' : '每天'
    }
    // ── 定时唤醒编辑(原设置页④区, 并入定时任务页): config.schedule.targets 分组 ──
    // 保存走 im-qqbot settings ns 全量 patch(与设置页同构, 防覆盖掉其它字段), live 热更新。
    // 聊天对象数据源(2026-09-05 统一): 群只列"活的"(host 已用官方 info 剔除注销群, 显示真群名);
    //   私聊用台账昵称, 缺名时用本地成员表(同 openid 在群里出现过的昵称)补 —— 不再露裸 id。
    function fetchChatTargets(acct) {
      var ns = acct && acct.ns && acct.ns !== 'im-qqbot' ? String(acct.ns) : ''
      var dd = acct && acct.dataDir ? String(acct.dataDir) : ''
      var qNs = ns ? '?ns=' + encodeURIComponent(ns) : ''
      var qDD = dd ? '?dataDir=' + encodeURIComponent(dd) : ''
      var qM = ns ? ('?ns=' + encodeURIComponent(ns)) : '' // members_local 不带 gid = 全部成员
      return Promise.all([
        fetch('/api/qqbot-settings/group/accounts' + qNs).then(function (r) { return r.json() }).catch(function () { return {} }),
        fetch('/api/qqbot-settings/known-chats' + qDD).then(function (r) { return r.json() }).catch(function () { return {} }),
        fetch('/api/qqbot-settings/group/members_local' + qM).then(function (r) { return r.json() }).catch(function () { return {} }),
      ]).then(function (rs) {
        var groups = ((rs[0] && rs[0].groups) || []).map(function (g) {
          return { scope: 'group', id: g.gid, name: g.name || '', lastSeen: g.lastAt || 0, count: 0 }
        })
        var known = ((rs[1] && rs[1].chats) || [])
        // 成员表: mid -> 最近昵称(给私聊/无台账名时补名)
        var nameByMid = {}
        ;((rs[2] && rs[2].members) || []).forEach(function (m) {
          if (m.mid && m.name) {
            var old = nameByMid[m.mid]
            if (!old || m.lastSeen > old.ts) nameByMid[m.mid] = { name: m.name, ts: m.lastSeen || 0 }
          }
        })
        var c2c = []
        var seen = {}
        known.forEach(function (c) {
          if (c.scope !== 'c2c' || !c.id || seen[c.id]) return
          seen[c.id] = 1
          var nm = c.name || (nameByMid[c.id] && nameByMid[c.id].name) || ''
          c2c.push({ scope: 'c2c', id: c.id, name: nm, lastSeen: c.lastSeen || 0, count: c.count || 0 })
        })
        // 只列真·私聊过的人(known-chats scope=c2c): 群成员没有可私聊会话(dsh 一会话一对象),
        // 且群 member_openid 与 c2c openid 不同域, 补进来定时发私聊必失败 —— 不混入。
        c2c.sort(function (a, b) { return (b.lastSeen || 0) - (a.lastSeen || 0) })
        return { group: groups, c2c: c2c }
      })
    }
    function WakeEditor(props) {
      // 多账号: 定时唤醒按当前账号 ns 读写; 表格=拍平行视图(行=对象×时刻), 存储仍是 targets 分组
      var _wkNs = props && props.acct && props.acct.ns && props.acct.ns !== 'im-qqbot' ? String(props.acct.ns) : ''
      var [cfg, setCfg] = useState(null)
      var [rev, setRev] = useState(undefined)
      var [knownChats, setKnownChats] = useState(null)
      var [msg, setMsg] = useState('')
      // 视图态: 筛选 tab + 对象搜索词(纯视图过滤)
      var [filter, setFilter] = useState('all') // all|group|c2c
      var [search, setSearch] = useState('')

      function load() {
        fetch(READ + (_wkNs ? '?ns=' + encodeURIComponent(_wkNs) : '')).then(function (r) { return r.json() }).then(function (d) {
          if (d && d.value) { setCfg(d.value); setRev(d.revision); setMsg('') }
          else { setMsg('读取失败: ' + JSON.stringify(d)) }
        }).catch(function (e) { setMsg('读取异常: ' + e.message) })
      }
      useEffect(function () { load() }, [])
      useEffect(function () {
        fetchChatTargets(props.acct).then(function (t) {
          var list = (t.group || []).concat(t.c2c || [])
          setKnownChats(list)
        }).catch(function () {})
      }, [])
      function targets() { return (cfg && cfg.schedule && Array.isArray(cfg.schedule.targets)) ? cfg.schedule.targets : [] }
      function setTargets(list) {
        setCfg(function (c) {
          var base = c || {}
          var s = (base.schedule && typeof base.schedule === 'object') ? base.schedule : {}
          return { ...base, schedule: Object.assign({}, s, { targets: list }) }
        })
      }

      // ── 拍平行行模型: [{tgIndex, tg, task}] ──
      function rows() {
        var out = []
        targets().forEach(function (tg, ti) {
          ;(tg.tasks || []).forEach(function (tt) {
            out.push({ ti: ti, tg: tg, task: tt })
          })
        })
        return out
      }
      function chatLabelOf(scope, id) {
        var hit = null
        ;(knownChats || []).forEach(function (c) { if (c.scope === scope && c.id === id) hit = c })
        if (hit && hit.name) return hit.name
        return id ? (id.length > 14 ? id.slice(0, 6) + '…' + id.slice(-4) : id) : ''
      }
      // 行操作 → 直接改 targets 分组(保持存储模型)
      function patchTask(ti, taskId, patch) {
        var list = targets().slice()
        var tg = { ...list[ti], tasks: (list[ti].tasks || []).map(function (t) { return t.id === taskId ? { ...t, ...patch } : t }) }
        list[ti] = tg
        setTargets(list)
      }
      // 行内改对象: 若该行所在组还挂着其它行(旧数据同组多时刻), 先拆成独立组再改, 保证只影响本行
      function pickObject(r, c) {
        var list = targets().slice()
        var tg = list[r.ti]
        if (!tg) return
        var tasks = (tg.tasks || []).slice()
        var patch = { scope: c.scope, targetId: c.id, name: c.name || '' }
        if (tasks.length <= 1) {
          list[r.ti] = { ...tg, ...patch }
        } else {
          var keep = tasks.filter(function (t) { return t.id !== r.task.id })
          var lone = tasks.filter(function (t) { return t.id === r.task.id })
          var ntg = { ...tg, ...patch, id: 'tg-' + Date.now().toString(36), tasks: lone }
          list.splice(r.ti, 1, { ...tg, tasks: keep }, ntg)
          list = list.filter(function (g) { return (g.tasks || []).length > 0 })
        }
        setTargets(list)
      }
      function rmRow(ti, taskId) {
        var list = targets().slice()
        var tg = { ...list[ti], tasks: (list[ti].tasks || []).filter(function (t) { return t.id !== taskId }) }
        if (tg.tasks.length === 0) list = list.filter(function (_, i) { return i !== ti }) // 空目标组一并删
        else list[ti] = tg
        setTargets(list)
      }
      function addRow() {
        var list = targets().slice()
        // 每行 = 独立目标组(对象列改起来互不牵连); 默认挂"全部"视图, scope 跟随当前筛选类型
        var nt = { id: 't-' + Date.now().toString(36), time: '09:00', enabled: true, prompt: '' }
        var scope = filter === 'c2c' ? 'c2c' : filter === 'group' ? 'group' : 'group'
        var ntg = { id: 'tg-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6), name: '', scope: scope, targetId: '', tasks: [nt] }
        list.push(ntg)
        setTargets(list)
      }
      // 保存: 整表(行→分组已实时同步)全量 patch
      function save() {
        setMsg('保存中…')
        var v = cfg || {}
        var patch = {
          behavior: v.behavior || {},
          sticker: {
            gates: (v.sticker && v.sticker.gates) || {},
            autoTagEnabled: !!(v.sticker && v.sticker.autoTagEnabled),
            visionCli: (v.sticker && typeof v.sticker.visionCli === 'string') ? v.sticker.visionCli : '',
          },
          injectRules: Array.isArray(v.injectRules) ? v.injectRules : [],
          imageHint: typeof v.imageHint === 'boolean' ? v.imageHint : undefined,
          messageReference: v.messageReference !== false,
          schedule: { targets: targets() },
          groupPrompt: typeof v.groupPrompt === 'string' ? v.groupPrompt : DEFAULT_GROUP_PROMPT,
        }
        fetch(UPDATE, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ patch: patch, expectedRevision: rev, ns: _wkNs || undefined }),
        }).then(function (r) { return r.json().catch(function () { return null }) }).then(function (d) {
          if (d && d.value) { setCfg(d.value); setRev(d.revision); setMsg('已保存 ✓(live 生效)') }
          else if (d && d.error) { setMsg('保存失败: ' + d.error) }
          else { setMsg('保存失败(未知响应)') }
        }).catch(function (e) { setMsg('保存异常: ' + e.message) })
      }
      if (!cfg) return h('p', null, msg || '加载中…')

      // 筛选行
      var allRows = rows()
      var shown = allRows.filter(function (r) {
        if (filter !== 'all' && r.tg.scope !== filter) return false
        if (search) {
          var q = search.toLowerCase()
          var nm = (chatLabelOf(r.tg.scope, r.tg.targetId) || '').toLowerCase()
          if (nm.indexOf(q) < 0 && String(r.task.prompt || '').toLowerCase().indexOf(q) < 0 && String(r.task.time).indexOf(q) < 0) return false
        }
        return true
      })

      // 渲染: 表格
      return h('div', null,
        h('p', { style: { fontSize: T.fsSm, color: T.warn, margin: '4px 0 6px' } }, '⚠️ QQ 平台: 主动发私聊需对方 48h 内跟机器人说过话, 超时会拒收(自动降级); 群一般没问题。想验证: 时间设成 1~2 分钟后保存等着看。'),
        // 工具条: 筛选 + 搜索 + 添加行
        h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', margin: '6px 0' } },
          h(TabBar, {
            items: [
              { key: 'all', label: '全部(' + allRows.length + ')' },
              { key: 'group', label: '群' },
              { key: 'c2c', label: '私聊' },
            ], value: filter, onChange: function (k) { setFilter(k); setMsg('') },
          }),
          h('input', { className: 'qqs-inp', style: { flex: 1, minWidth: 120, padding: '3px 8px', border: '1px solid ' + T.border, borderRadius: T.radius }, placeholder: '搜对象 / 描述 / 时间…', value: search, onChange: function (e) { setSearch(e.target.value) } }),
          h(SButton, { variant: 'primary', size: 'sm', onClick: addRow }, '+ 添加一行')),
        // 表格头
        h('div', { style: { display: 'flex', alignItems: 'center', background: T.cardHi, border: '1px solid #dde1e7', borderRadius: T.radius + ' ' + T.radius + ' 0 0', fontWeight: 700, fontSize: T.fsSm, color: T.text2 } },
          h('div', { style: { width: 90, padding: '8px 10px' } }, '时间'),
          h('div', { style: { flex: '1 1 26%', minWidth: 140, padding: '8px 10px' } }, '对象'),
          h('div', { style: { flex: '2 1 38%', minWidth: 160, padding: '8px 10px' } }, '任务描述'),
          h('div', { style: { width: 80, padding: '8px 10px', textAlign: 'center' } }, '每天'),
          h('div', { style: { width: 56, padding: '8px 10px', textAlign: 'center' } }, '')),
        // 行
        shown.length === 0 ? h('div', { style: { border: '1px solid ' + T.border, borderTop: 'none', borderRadius: '0 0 ' + T.radius + ' ' + T.radius, padding: 22, textAlign: 'center', color: T.text3, fontSize: T.fsSm } }, '还没有任务行 —— 点「+ 添加一行」开始配置')
          : shown.map(function (r, idx) {
            var tg = r.tg, tt = r.task
            var nm = chatLabelOf(tg.scope, tg.targetId)
            return h('div', { key: tg.id + ':' + tt.id, style: { display: 'flex', alignItems: 'center', background: idx % 2 ? T.cardHi : '#ffffff', borderBottom: '1px solid #dde1e7', borderLeft: '1px solid #dde1e7', borderRight: '1px solid #dde1e7', fontSize: T.fsSm } },
              // 时间
              h('div', { style: { width: 90, padding: '6px 8px' } },
                h('input', { className: 'qqs-inp', style: { width: 62, padding: '2px 6px', border: '1px solid ' + T.border, borderRadius: T.radius }, value: sv(tt.time), placeholder: '09:00', onChange: function (e) { patchTask(r.ti, tt.id, { time: e.target.value }) } })),
              // 对象: 类型小标 + 可搜索选择器(点击弹出, 输入过滤; 每行独立, 互不牵连)
              h('div', { style: { flex: '1 1 26%', minWidth: 150, padding: '6px 8px', display: 'flex', gap: 4, alignItems: 'center' } },
                h('span', { style: { flexShrink: 0, fontSize: 10, padding: '0 5px', borderRadius: 4, color: '#fff', background: tg.scope === 'c2c' ? T.primary : T.primary2 } }, tg.scope === 'c2c' ? '私' : '群'),
                h(TargetPicker, { value: { scope: tg.scope, targetId: tg.targetId, name: nm }, options: knownChats || [], onPick: function (c) { pickObject(r, c) } })),
              // 描述
              h('div', { style: { flex: '2 1 38%', minWidth: 160, padding: '6px 8px' } },
                h('input', { className: 'qqs-inp', style: { width: '100%', padding: '2px 6px', border: '1px solid ' + T.border, borderRadius: T.radius, fontSize: T.fsSm }, value: sv(tt.prompt), placeholder: '例: 早上好, 提醒大家吃早饭(留空=自由发挥)', onChange: function (e) { patchTask(r.ti, tt.id, { prompt: e.target.value }) } })),
              // 每天 toggle = 启停
              h('div', { style: { width: 80, padding: '6px 8px', textAlign: 'center' } },
                h('input', { type: 'checkbox', checked: !!tt.enabled, onChange: function (e) { patchTask(r.ti, tt.id, { enabled: e.target.checked }) } })),
              // 删除
              h('div', { style: { width: 56, padding: '6px 8px', textAlign: 'center' } },
                h('button', { className: 'qqs-btn', style: { padding: '1px 8px', fontSize: 11, color: T.danger, background: 'transparent', border: 'none', cursor: 'pointer' }, onClick: function () { if (window.confirm('删除这一行?')) rmRow(r.ti, tt.id) } }, '✕')),
            )
          }),
        h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', margin: '10px 0 2px' } },
          h(SButton, { variant: 'primary', size: 'sm', onClick: save }, '保存定时唤醒'),
          h(SButton, { variant: 'ghost', size: 'sm', onClick: load }, '放弃修改'),
          msg ? h('span', { style: { fontSize: T.fsSm, color: T.success } }, msg) : null))
    }

    function TimersPage(props) {
      // 多账号: 定时任务按当前账号 schedDir(={cwd}/.qqbot)
      var _tmSD = props && props.acct && props.acct.schedDir ? String(props.acct.schedDir) : ''
      var _tmQ = _tmSD ? '?schedDir=' + encodeURIComponent(_tmSD) : ''
      var [jobs, setJobs] = useState(null)
      var [msg, setMsg] = useState('')
      var [busyId, setBusyId] = useState('')
      // 名称解析(2026-09-05): 群=活群真名(accounts 已剔除注销群), 私聊=台账昵称+成员表补名
      var [chatTg, setChatTg] = useState(null) // 活群/昵称台账: null=加载中(不判失效), 数组=已加载
      function load() {
        fetch(API_TIMERS + _tmQ).then(function (r) { return r.json() }).then(function (d) {
          if (d && Array.isArray(d.jobs)) setJobs(d.jobs.slice().reverse())
          else setMsg('读取失败: ' + JSON.stringify(d))
        }).catch(function (e) { setMsg('读取异常: ' + e.message) })
      }
      useEffect(function () {
        load()
        fetchChatTargets(props.acct).then(function (t) { setChatTg(t && t.group ? t : { group: [], c2c: [] }) }).catch(function () { setChatTg({ group: [], c2c: [] }) })
      }, [])
      function nameOf(scope, id) {
        if (!chatTg) return ''
        var nm = ''
        ;(chatTg[scope] || []).forEach(function (x) { if (x.id === id) nm = x.name || nm })
        return nm
      }
      function isGroupAlive(gid) {
        // 台账未加载(null)时不判失效——避免每次进页面先闪"群已失效"; 加载完成后按真实台账判定
        if (!chatTg) return true
        return (chatTg.group || []).some(function (g) { return g.id === gid })
      }
      function act(job, body, okMsg) {
        if (busyId) return
        setBusyId(job.id)
        fetch(API_TIMERS, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(Object.assign({ id: job.id, schedDir: _tmSD || undefined }, body || {})) })
          .then(function (r) { return r.json() })
          .then(function (d) {
            if (d && d.error) setMsg('失败: ' + d.error)
            else { setMsg(okMsg + ' ✓'); load() }
          })
          .catch(function (e) { setMsg('操作失败: ' + e.message) })
          .then(function () { setBusyId('') })
      }
      function who(job) {
        var scope = job.scope === 'c2c' ? 'c2c' : 'group'
        var nm = nameOf(scope, job.peerId)
        if (!nm) return (scope === 'c2c' ? '私聊' : '群聊') + ' · ' + String(job.peerId || '').slice(0, 8)
        return (scope === 'c2c' ? '私聊 · ' : '群聊 · ') + nm
      }
      function chip(kind) {
        return h('span', { style: { fontSize: 11, padding: '1px 8px', borderRadius: 999, color: '#fff', background: kind === 'daily' ? '#2f9e44' : '#4d7cfe', whiteSpace: 'nowrap' } },
          kind === 'daily' ? '每天' : '一次性')
      }
      // 左右分栏: 左=定时唤醒(编辑), 右=已安排的定时提醒(开关/删除)——有效利用横向空间
      var leftCol = h('div', { style: { flex: '1 1 44%', minWidth: 280, maxWidth: 560 } },
        h('div', { style: { ...card, padding: '10px 14px' } },
          h('div', { style: { fontWeight: 700, fontSize: 13 } }, '① 定时唤醒(每天到点,让她主动去群/私聊开口)'),
          h('p', { style: { fontSize: T.fsSm, color: T.text3 } }, '每个群/人一组,下面可加多个时刻。不用记号码——点「选聊天对象」挑见过的就行(群显示真名/人显示昵称)。改完点「保存」。'),
          h(WakeEditor, { acct: props.acct })))
      var rightCol = h('div', { style: { flex: '1 1 44%', minWidth: 280 } },
        h('div', { style: { ...card, padding: '10px 14px' } },
          h('div', { style: { fontWeight: 700, fontSize: 13 } }, '② 她答应你的定时提醒(在 QQ 里说一声就能建)'),
          h('p', { style: { fontSize: T.fsSm, color: T.text3 } }, '这些是她在 QQ 里应你要求安排的提醒。这里只管看/开关/删除;一次性到点自动消失。'),
          jobs === null ? h('p', { style: { fontSize: T.fsSm, color: T.text3 }, padding: 10 }, '加载中…') : null,
          jobs !== null && jobs.length === 0 ? h('p', { style: { color: '#888', padding: 14, textAlign: 'center', fontSize: T.fsSm } }, '还没有这类提醒。去 QQ 里让她安排一个,就会出现在这里。') : null,
          (jobs || []).map(function (j) {
            var disabled = busyId === j.id
            var deadGroup = j.scope === 'group' && !isGroupAlive(j.peerId)
            return h('div', { key: j.id, style: { border: '1px solid ' + (deadGroup ? T.danger + '88' : (j.enabled ? T.border : '#ffa94d66')), borderRadius: T.radius, padding: '8px 10px', margin: '6px 0', background: '#fff', opacity: j.enabled ? 1 : 0.72 } },
              h('div', { style: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' } },
                chip(j.kind),
                h('span', { style: { fontWeight: 600, fontSize: T.fsSm } }, fmtWhen(j)),
                h('span', { style: { fontSize: T.fsSm, color: deadGroup ? T.danger : T.text2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 150 } }, deadGroup ? (who(j) + '(群已失效)') : who(j)),
                h('span', { style: { flex: 1 } }),
                h('label', { style: { fontSize: T.fsSm, whiteSpace: 'nowrap', color: j.enabled ? T.primary : '#ffa94d' } },
                  h('input', { className: 'qqs-cb', type: 'checkbox', checked: !!j.enabled, disabled: disabled, onChange: function (e) { act(j, { enabled: e.target.checked }, e.target.checked ? '已启用' : '已停用') } }),
                  ' ' + (j.enabled ? '启用中' : '已停用')),
                h('button', { className: 'qqs-btn', disabled: disabled, style: { padding: '2px 8px', fontSize: T.fsSm }, onClick: function () { if (window.confirm('删除这条定时任务?')) act(j, {}, '已删除') } }, '删除')),
              j.prompt ? h('div', { style: { fontSize: T.fsSm, color: '#cfd3dc', background: '#ffffff0a', border: '1px solid #ffffff14', borderRadius: T.radius, padding: '4px 8px', marginTop: 4, whiteSpace: 'pre-wrap', wordBreak: 'break-all' } }, j.prompt) : null)
          }),
          msg ? h('p', { style: { fontSize: T.fsSm, color: T.success } }, msg) : null))
      return h('div', { style: { width: '100%' } },
        h('div', { style: { display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' } }, leftCol, rightCol),
        props && props.close ? h('button', { className: 'qqs-btn', onClick: props.close, style: { float: 'right', marginTop: 6 } }, '完成') : null)
    }

    // ── 单入口壳: 设置 / 表情包图库 / 定时任务 三个胶囊 tab 页内切换 ──
    var TAB_KEY = 'qqs-home-tab'
    var ACCT_KEY = 'qqs-acct'
    function QqbotHome(props) {
      var [tab, setTab] = useState(null)
      var [accts, setAccts] = useState(null)
      var [acctId, setAcctId] = useState('')
      var [badges, setBadges] = useState({})
      // 当前操作账号(缺省=第一个启用的实例, 兼容单账号)
      function currentAcct() {
        var list = accts || []
        if (acctId) { var p = null; list.forEach(function (a) { if (a.id === acctId) p = a }); if (p) return p }
        var first = null
        list.forEach(function (a) { if (!first && !a.disabled) first = a })
        return first || list[0] || null
      }
      useEffect(function () {
        var saved = ''
        try { saved = localStorage.getItem(TAB_KEY) || '' } catch (e) {}
        setTab(saved === 'gallery' || saved === 'timers' || saved === 'accounts' ? saved : 'settings')
        fetch('/api/qqbot-settings/accounts').then(function (r) { return r.json() }).then(function (d) {
          if (d && Array.isArray(d.instances)) {
            setAccts(d.instances)
            var want = ''
            try { want = localStorage.getItem(ACCT_KEY) || '' } catch (e) {}
            var found = null
            d.instances.forEach(function (a) { if (a.id === want) found = a.id })
            setAcctId(found || '')
          }
        }).catch(function () {})
      }, [])
      // 角标按当前账号
      useEffect(function () {
        var ac = currentAcct()
        var alive = true
        var ddq = ac && ac.dataDir ? '&dataDir=' + encodeURIComponent(ac.dataDir) : ''
        var sdq = ac && ac.schedDir ? '?schedDir=' + encodeURIComponent(ac.schedDir) : ''
        Promise.all([
          fetch('/api/qqbot-settings/stickers?untagged=1&layer=candidate' + ddq).then(function (r) { return r.json() }).catch(function () { return {} }),
          fetch(API_TIMERS + sdq).then(function (r) { return r.json() }).catch(function () { return {} }),
        ]).then(function (rs) {
          if (!alive) return
          var unt = rs[0] && typeof rs[0].total === 'number' ? rs[0].total : 0
          var on = 0
          var list = (rs[1] && rs[1].jobs) || []
          list.forEach(function (j) { if (j.enabled) on += 1 })
          setBadges({ untagged: unt, timers: on })
        })
        return function () { alive = false }
      }, [accts, acctId])
      if (!tab) return h('div', null, '…')
      function choose(t) { setTab(t); try { localStorage.setItem(TAB_KEY, t) } catch (e) {} }
      function chooseAcct(id) { setAcctId(id); try { localStorage.setItem(ACCT_KEY, id) } catch (e) {} }
      function badge(n) {
        return n > 0 ? h('span', { style: { background: '#ff6b6b', color: '#fff', borderRadius: 9, padding: '0 6px', fontSize: 11, lineHeight: '16px', display: 'inline-block', fontWeight: 700, flexShrink: 0 } }, n) : null
      }
      var ac = currentAcct()
      // 传给按账号视图的上下文: 设置按 ns, 图库按 dataDir, 定时按 schedDir
      var acctx = ac ? { id: ac.id, ns: ac.ns, dataDir: ac.dataDir, schedDir: ac.schedDir } : null
      // key=账号: 切号即强制子页整页重挂(清掉旧账号 state, 全部重新拉取)
      var subKey = ac ? ac.id : 'main'
      var sub = tab === 'gallery' ? h(GalleryPage, { key: subKey, close: props && props.close, acct: acctx })
        : tab === 'timers' ? h(TimersPage, { key: subKey, close: props && props.close, acct: acctx })
        : tab === 'accounts' ? h(AccountsPage, { close: props && props.close })
        : h(SettingsPage, { key: subKey, close: props && props.close, acct: acctx })
      var acctLine = (accts && accts.length > 1) || (accts && accts.length === 1)
      return h('div', { style: { width: '100%' } },
        // ── 一级: 账号选择条(身份带) ──
        h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', margin: '2px 0 10px', padding: '6px 10px', border: '1px solid #b197fc55', borderRadius: 12, background: 'linear-gradient(90deg,#b197fc22,#b197fc0a)' } },
          h('span', { style: { fontSize: 13, fontWeight: 800, color: '#171a21', whiteSpace: 'nowrap' } }, '🤖 正在查看:'),
          accts && accts.length > 0
            ? h('select', { className: 'qqs-inp', style: { padding: '4px 8px', fontWeight: 700 }, value: ac ? ac.id : '', onChange: function (e) { chooseAcct(e.target.value) } },
              accts.map(function (a) {
                return h('option', { key: a.id, value: a.id }, a.id + (a.appId ? ' (AppID ' + a.appId + ')' : '') + (a.disabled ? ' [停用]' : ''))
              }))
            : h('span', { style: { fontSize: 13, color: '#888' } }, '无账号… 去「账号与预设」添加'),
          ac ? h('span', { style: { fontSize: 12, color: '#6d28d9', whiteSpace: 'nowrap' } }, ac.dataDir ? '数据目录: ' + ac.dataDir : '') : null,
          h('span', { style: { flex: 1 } }),
          h('span', { style: { fontSize: 12, color: '#8a97ad' } }, '设置/图库/定时 都跟随上面选的机器人')),
        h('div', { style: { position: 'sticky', top: 0, zIndex: 30, background: 'transparent', padding: '10px 4px 12px', display: 'flex', gap: 10, flexWrap: 'nowrap', alignItems: 'stretch', marginBottom: 12 } },
          [['settings', '设置', '#ff5d5d'], ['gallery', '表情包图库', '#ffd97a'], ['timers', '定时任务', '#5b9dff'], ['accounts', '账号与预设', '#b197fc']].map(function (t) {
            var on = tab === t[0]
            var n = t[0] === 'gallery' ? badges.untagged : t[0] === 'timers' ? badges.timers : 0
            var col = t[2]
            return h('button', { key: t[0], onClick: function () { choose(t[0]) },
              style: {
                flex: 1, minWidth: 0, cursor: 'pointer', font: 'inherit',
                color: '#171a21', fontSize: 14, textAlign: 'center',
                whiteSpace: 'nowrap', padding: '9px 8px', borderRadius: 14,
                border: '1px solid ' + (on ? col : col + 'a6'),
                background: 'linear-gradient(165deg,' + col + (on ? '66' : '40') + ',' + col + (on ? '1f' : '14') + ')',
                boxShadow: on
                  ? '0 0 18px ' + col + 'cc, inset 0 0 16px ' + col + '66'
                  : '0 0 10px ' + col + '73, inset 0 0 12px ' + col + '47',
                fontWeight: on ? 800 : 600,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
                transition: 'all .15s', outline: 'none',
              } },
              t[1], badge(n))
          })),
        sub)
    }

    // ── 账号与预设(第4 tab): 多机器人账号(appId/secret/预设/cwd) + agent 预设复制管理 ──
    var API_ACCOUNTS = '/api/qqbot-settings/accounts'
    var API_PRESETS = '/api/qqbot-settings/presets'
    var API_BIND = '/api/qqbot-settings/bind'
    var API_WORKSPACES = '/api/qqbot-settings/workspaces'
    // appSecret 掩码(借鉴 dsh-qqbot-panel): host 只回显掩码, 留空/掩码保存=保留原值
    var SECRET_MASK = '********'
    var PRESET_HINT = '想改人设：点预设卡片「打开文件夹」，编辑里面 agent.cordis.yml —— persona 插件 config.text 那段就是人设正文(改完保存并重启 dsh 生效)；preset.yml 的 name 是预设显示名。做新人格：选一个预设点「复制」，填「预设 id」(=文件夹名,字母/数字开头,可含 - _) 和「人设名」(中文随意)，保存后自动生成新预设文件夹。'
    function inputRow(label, node) {
      return h('label', { style: { display: 'block', margin: '5px 0', fontSize: 13 } }, label, node)
    }
    function AccountsPage(props) {
      var [insts, setInsts] = useState(null)
      var [presets, setPresets] = useState([])
      var [root, setRoot] = useState('')
      var [workspaces, setWorkspaces] = useState([])
      var [msg, setMsg] = useState('')
      var [busy, setBusy] = useState('')
      var [bind, setBind] = useState(null) // {id,url,status,error,iframeUrl}
      var [copy, setCopy] = useState(null) // 复制弹层: {sourceId}
      var [copyId, setCopyId] = useState('')
      var [copyName, setCopyName] = useState('')
      var [collapsed, setCollapsed] = useState({})
      var [addMenu, setAddMenu] = useState(false)
      var [editP, setEditP] = useState(null)
      var [editFiles, setEditFiles] = useState([])
      var [editFile, setEditFile] = useState('')
      var [editContent, setEditContent] = useState('')
      var [editMsg, setEditMsg] = useState('')
      var [editBusy, setEditBusy] = useState(false)
      var pollRef = React.useRef(null)
      function load(quiet) {
        Promise.all([
          fetch(API_ACCOUNTS).then(function (r) { return r.json() }).catch(function () { return {} }),
          fetch(API_PRESETS).then(function (r) { return r.json() }).catch(function () { return {} }),
          fetch(API_WORKSPACES).then(function (r) { return r.json() }).catch(function () { return {} }),
        ]).then(function (rs) {
          var a = rs[0] || {}
          if (Array.isArray(a.instances)) setInsts(a.instances)
          var p = rs[1] || {}
          if (Array.isArray(p.presets)) { setPresets(p.presets); if (p.root) setRoot(p.root) }
          var w = rs[2] || {}
          if (Array.isArray(w.workspaces)) setWorkspaces(w.workspaces)
          if (!quiet) setMsg('')
        })
      }
      useEffect(function () { load(true) }, [])
      // 自动填充: 账号没选 preset 时自动带上候选中的第一个(浏览器 select 默认显示 ≠ state 值,
      // 不真正写入 state 的话保存会丢 preset——主人实测: 不手动切换选择就保存不了)。
      // 与渲染处同规则算候选(host 没给 hasChannelTools 字段时视全部为候选, 不锁死)。
      // 候选数量不限: 有候选就把空缺账号填上第一个, 用户仍可手动改选。
      useEffect(function () {
        if (!Array.isArray(presets) || presets.length === 0) return
        if (!Array.isArray(insts) || insts.length === 0) return
        // QQ 工具由会话自动挂载(2026-09-06) → 预设不再需要带标, 全部可作候选
        var only = presets
        if (only.length === 0) return
        var changed = false
        var next = insts.map(function (x) {
          if (x.preset) return x
          changed = true
          return Object.assign({}, x, { preset: only[0].id })
        })
        if (changed) setInsts(next)
      }, [insts, presets])
      useEffect(function () { return function () { if (pollRef.current) clearInterval(pollRef.current) } }, [])
      function upd(i, patch) { setInsts(function (list) { var n = list.slice(); n[i] = Object.assign({}, n[i], patch); return n }) }
      function toggleCollapse(id) { setCollapsed(function (m) { var n = Object.assign({}, m); n[id] = !n[id]; return n }) }
      function addBlank() {
        var base = 'im-qqbot'
        var used = new Set((insts || []).map(function (x) { return x.id }))
        var n = 2
        while (used.has(base + '-' + n)) n += 1
        setInsts(function (list) { return (list || []).concat([{ id: base + '-' + n, appId: '', appSecret: '', preset: '', cwd: '', disabled: false, _new: true }]) })
      }
      function addBound(cred) {
        var base = 'im-qqbot'
        var used = new Set((insts || []).map(function (x) { return x.id }))
        var n = 2
        while (used.has(base + '-' + n)) n += 1
        setInsts(function (list) { return (list || []).concat([{ id: base + '-' + n, appId: cred.appId, appSecret: cred.appSecret, preset: '', cwd: '', disabled: false, _bound: true }]) })
      }
      function save() {
        if (busy) return
        setBusy('save'); setMsg('保存中…')
        var list = (insts || []).filter(function (x) { return x.id && (x.appId || x.appSecret || x.hasSecret || !x._new || x._bound) })
        // 空账号(全空且没绑定)不保存; 全新手动号若两凭据都空则提示(hasSecret=已保存的账号不算空)
        var blanks = list.filter(function (x) { return !x.appSecret && !x.hasSecret && !x._bound })
        if (blanks.length && !window.confirm('有 ' + blanks.length + ' 个账号没填 appSecret(不填的会被保存为只有骨架的实例, 可能启动就弹扫码)。继续?')) { setBusy(''); return }
        // 保存兜底: preset 仍为空的账号自动填第一个候选(防 effect 未触发/用户未手动选导致保存丢 preset)
        var candNow = presets
        if (candNow.length > 0) {
          var autoId = candNow[0].id
          list = list.map(function (x) { return x.preset ? x : Object.assign({}, x, { preset: autoId }) })
        }
        fetch(API_ACCOUNTS + '/save', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ instances: list.map(function (x) { return { id: x.id, appId: x.appId, appSecret: x.appSecret, preset: x.preset, cwd: x.cwd, disabled: !!x.disabled } }) }),
        }).then(function (r) { return r.json() }).then(function (d) {
          setBusy('')
          if (d && d.error) setMsg('保存失败: ' + d.error)
          else setMsg('已保存到 cordis.patch.yml ✓ —— 重启 dsh(web) 后生效')
          load(true)
        }).catch(function (e) { setBusy(''); setMsg('保存异常: ' + e.message) })
      }
      function removeInst(i) {
        var list = (insts || []).slice()
        var one = list[i]
        if (!window.confirm('删除账号实例 ' + one.id + '? (它的配置会从 cordis.patch.yml 移除)')) return
        list.splice(i, 1)
        setInsts(list)
      }
      // ── 扫码绑定 ──
      function startBind() {
        setBind({ id: '', url: '', status: 'start', error: '' })
        fetch(API_BIND + '/start', { method: 'POST' }).then(function (r) { return r.json() }).then(function (d) {
          if (d && d.error) { setBind({ id: '', url: '', status: 'error', error: d.error }); return }
          var b = { id: d.id, url: d.url, status: 'wait', error: '', iframeUrl: d.url }
          setBind(b)
          if (pollRef.current) clearInterval(pollRef.current)
          pollRef.current = setInterval(function () {
            fetch(API_BIND + '/poll?id=' + encodeURIComponent(b.id)).then(function (r) { return r.json() }).then(function (p) {
              if (p.status === 'done') {
                clearInterval(pollRef.current); pollRef.current = null
                addBound({ appId: p.appId, appSecret: p.appSecret })
                setMsg('🎉 扫码绑定成功! 平台下发的 AppID/Secret 已填好, 起个名字保存即可')
                setBind(null)
              } else if (p.status === 'error') {
                clearInterval(pollRef.current); pollRef.current = null
                setBind({ id: b.id, url: p.url || b.url, status: 'error', error: p.error || '绑定失败', iframeUrl: p.url || b.url })
              } else {
                setBind(function (old) { return old && old.id === b.id ? Object.assign({}, old, { url: p.url || old.url, iframeUrl: (p.url && p.url !== old.url) ? p.url : old.iframeUrl }) : old })
              }
            }).catch(function () {})
          }, 2500)
        }).catch(function (e) { setBind({ id: '', url: '', status: 'error', error: e.message }) })
      }
      function cancelBind() {
        if (bind && bind.id) { try { fetch(API_BIND + '/cancel', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: bind.id }) }) } catch (e) {} }
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
        setBind(null)
      }
      // ── 预设复制 ──
      function doCopy() {
        if (!copy) return
        setBusy('copy')
        var url = copy.fromStandard ? API_PRESETS + '/new' : API_PRESETS + '/copy'
        var payload = copy.fromStandard
          ? { id: copyId.trim(), name: copyName.trim() }
          : { sourceId: copy.sourceId, newId: copyId.trim(), newName: copyName.trim() }
        fetch(url, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        }).then(function (r) { return r.json() }).then(function (d) {
          setBusy('')
          if (d && d.error) { setMsg('复制失败: ' + d.error); return }
          setMsg('✅ 新预设已生成: ' + d.newId + (copy.fromStandard ? ' (复制自标准模式, 已带 QQ 工具)' : '') + '。去「打开文件夹」改人设吧。')
          setCopy(null); setCopyId(''); setCopyName('')
          load(true)
        }).catch(function (e) { setBusy(''); setMsg('复制异常: ' + e.message) })
      }
      function openPreset(id) {
        fetch(API_PRESETS + '/open', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: id }) })
          .then(function (r) { return r.json() }).then(function (d) { if (d && d.ok) setMsg('已在本机打开文件夹'); else if (d && d.error) setMsg(d.error) })
          .catch(function (e) { setMsg('打开失败: ' + e.message) })
      }
      // ── 人格编辑器(2026-09-07): 展开/改写预设人格文件(仅带QQ工具标记的副本可写, host 端二次校验) ──
      function loadEditFile(id, name) {
        fetch(API_PRESETS + '/file?id=' + encodeURIComponent(id) + '&name=' + encodeURIComponent(name))
          .then(function (r) { return r.json() }).then(function (d) {
            if (d && typeof d.content === 'string') { setEditContent(d.content); setEditMsg('') }
            else { setEditContent(''); setEditMsg('读取失败: ' + ((d && d.error) || '未知')) }
          }).catch(function (e) { setEditMsg('读取异常: ' + e.message) })
      }
      function openPresetEditor(p) {
        setEditP(p); setEditFiles([]); setEditFile(''); setEditContent(''); setEditMsg('')
        fetch(API_PRESETS + '/files?id=' + encodeURIComponent(p.id))
          .then(function (r) { return r.json() }).then(function (d) {
            if (d && Array.isArray(d.files)) {
              setEditP(function (prev) { return prev ? Object.assign({}, prev, { writable: !!d.writable }) : prev })
              setEditFiles(d.files)
              var def = d.files[0] ? d.files[0].name : ''
              setEditFile(def)
              if (def) loadEditFile(p.id, def)
              else setEditMsg('该预设没有可编辑文本文件')
            } else setEditMsg('读取失败: ' + ((d && d.error) || '未知'))
          }).catch(function (e) { setEditMsg('读取异常: ' + e.message) })
      }
      function pickEditFile(name) {
        setEditFile(name); setEditContent(''); setEditMsg('')
        if (editP) loadEditFile(editP.id, name)
      }
      function saveEditFile() {
        if (!editP || editBusy) return
        setEditBusy(true); setEditMsg('')
        fetch(API_PRESETS + '/file', {
          method: 'PUT', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: editP.id, name: editFile, content: editContent }),
        }).then(function (r) { return r.json() }).then(function (d) {
          setEditBusy(false)
          if (d && d.ok) setEditMsg('✅ 已保存 ' + d.name + ' —— 新会话生效')
          else setEditMsg('保存失败: ' + ((d && d.error) || '未知'))
        }).catch(function (e) { setEditBusy(false); setEditMsg('保存异常: ' + e.message) })
      }
      var st = { width: '100%', padding: '5px 8px', boxSizing: 'border-box' }
      return h('div', { style: { maxWidth: 860 } },
        h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 } },
          h('h2', { style: { margin: 0 } }, '账号与预设'),
          h('div', { style: { display: 'flex', gap: 6, alignItems: 'center' } },
            h('button', { className: 'qqs-btn', title: '保存账号配置(保存后重启生效)', onClick: save, disabled: busy === 'save', style: { fontSize: 16, padding: '4px 12px', lineHeight: '20px' } }, '💾'),
            h('button', { className: 'qqs-btn', title: '重新读取(放弃未保存的修改)', onClick: function () { load() }, style: { fontSize: 16, padding: '4px 12px', lineHeight: '20px' } }, '🔄'))),
        h('p', { style: { fontSize: 12, color: '#888' } }, '一个 QQ 机器人 = 一个账号实例(AppID/AppSecret)。想同时开几个机器人就加几个实例，每个可以配不同的 agent 预设(人格)与工作目录(各人各数据,不串)。⚠️ appSecret 会明文存在本机 cordis.patch.yml(改前自动备份 .bak)，别把配置文件传上网。'),
        h('div', { style: sectionTitle }, '① 机器人账号(改完点保存, 重启生效)'),
        (insts === null ? h('p', null, '加载中…') : null),
        (insts || []).map(function (it, i) {
          // QQ 工具由机器人会话自动挂载(2026-09-06) → 预设全列可选, 不再限定"带QQ工具"标记
          var usable = presets.slice()
          var selInvalid = it.preset && !usable.some(function (p) { return p.id === it.preset })
          var opts = usable.map(function (p) { return { id: p.id, label: p.name + ' (' + p.id + ')' } })
          if (selInvalid) opts.unshift({ id: it.preset, label: '⚠️ ' + it.preset + '(预设不存在, 请重选)' })
          // 默认收起: 老账号折叠, 新建(_new/_bound)展开待填; 用户手动切换后以 collapsed 为准
          var folded = collapsed[it.id] !== undefined ? !!collapsed[it.id] : (!it._new && !it._bound)
          return h('div', { key: it.id, style: { border: '1px solid ' + (it.disabled ? '#ffa94d66' : '#00000026'), borderRadius: 10, padding: '8px 12px', margin: '8px 0', background: 'rgba(255,255,255,.5)' } },
            h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
              h('button', { className: 'qqs-btn', title: folded ? '展开设置' : '收起设置', onClick: function () { toggleCollapse(it.id) }, style: { padding: '1px 7px', fontSize: 13, lineHeight: '16px', background: '#0000000d', borderColor: '#00000026' } }, folded ? '▸' : '▾'),
              h('span', { style: { fontWeight: 800, color: '#171a21', cursor: 'pointer', userSelect: 'none' }, onClick: function () { toggleCollapse(it.id) } }, it._bound ? '📱 扫码绑定' : (it._new ? '🆕 新账号' : '🤖 账号')),
              h('input', { className: 'qqs-inp', style: Object.assign({ width: 170 }, st), value: it.id, disabled: !it._new && !it._bound, onChange: function (e) { upd(i, { id: e.target.value }) }, placeholder: '实例 id(如 im-qqbot-2)' }),
              h('label', { style: { fontSize: 13, whiteSpace: 'nowrap' } },
                h('input', { className: 'qqs-cb', type: 'checkbox', checked: !it.disabled, onChange: function (e) { upd(i, { disabled: !e.target.checked }) } }), ' 启用'),
              h('span', { title: it.disabled ? '已停用' : (it.online ? '在线(绿点)' : '离线/未知(灰点)'), style: { width: 10, height: 10, borderRadius: '50%', display: 'inline-block', background: it.disabled ? '#adb5bd' : (it.online ? '#2f9e44' : '#ced4da'), boxShadow: it.online ? '0 0 0 3px rgba(47,158,68,.18)' : 'none', flex: '0 0 auto', marginLeft: 2 } }),
              h('button', { className: 'qqs-btn', onClick: function () { removeInst(i) }, style: { marginLeft: 'auto' } }, '删除')),
            (folded ? null : h('div', { style: { marginTop: 4 } },
              inputRow('AppID: ', h('input', { className: 'qqs-inp', style: Object.assign({ width: 220 }, st), value: it.appId || '', onChange: function (e) { upd(i, { appId: e.target.value }) }, placeholder: '如 1234567890' })),
            inputRow('AppSecret: ', h('input', { className: 'qqs-inp', type: 'password', style: Object.assign({ width: 320 }, st), value: (it.appSecret === SECRET_MASK || (!it.appSecret && it.hasSecret)) ? '' : (it.appSecret || ''), onChange: function (e) { upd(i, { appSecret: e.target.value }) }, placeholder: (it.hasSecret && !it._new) ? '已保存(留空/掩码=保留原值; 填新值=更换)' : '扫码绑定会自动填; 也可手动填(两个都要填全才不弹码)' })),
            inputRow('Agent 预设(人格): ', (function () { if (presets.length === 0 && !selInvalid) {
                return h('span', { className: 'qqs-inp', style: { display: 'inline-block', verticalAlign: 'middle', padding: '5px 10px', fontSize: 12, color: '#e8590c', background: '#fff5f0', borderRadius: 6 } }, '⚠️ 还没有任何 Agent 预设——请在下方②新建/复制一个')
              } return h('select', { className: 'qqs-inp', style: { width: 320, padding: '4px 8px' }, value: it.preset || '', onChange: function (e) { upd(i, { preset: e.target.value }) } }, opts.map(function (o) { return h('option', { key: o.id, value: o.id, style: selInvalid && o.id === it.preset ? { color: '#e03131' } : null }, o.label) })) })()),
            inputRow('工作目录(各账号数据放这, 留空=默认): ', h('input', { className: 'qqs-inp', style: Object.assign({ width: '90%' }, st), value: it.cwd || '', onChange: function (e) { upd(i, { cwd: e.target.value }) }, placeholder: '如 D:\\bots\\二号机' })),
            (function () {
              var ws = (workspaces || []).filter(function (w) { return w.path && w.count > 0 })
              if (ws.length === 0) return null
              return h('div', { style: { margin: '2px 0 4px', fontSize: 12, color: '#555' } },
                '📁 已有 dsh 会话的工作区(点选填入上方): ',
                ws.map(function (w) {
                  return h('button', { key: w.dir, className: 'qqs-btn', style: { fontSize: 11, padding: '1px 8px', margin: '2px 4px 2px 0' }, onClick: function () { upd(i, { cwd: w.path }) } },
                    (w.path.length > 46 ? w.path.slice(0, 43) + '…' : w.path) + ' (' + w.count + ')')
                }))
           })())))
        }),
        h('div', { style: { position: 'relative', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', margin: '8px 0' } },
          h('button', { className: 'qqs-btn', onClick: function () { setAddMenu(!addMenu) }, style: { borderColor: '#b197fc99', color: '#171a21', fontWeight: 700 } }, addMenu ? '✕ 关闭' : '➕ 添加账号'),
          h('span', { style: { fontSize: 12, color: '#888' } }, '点加号选: 扫码绑定 或 手动填凭据'),
          (addMenu
            ? h('div', { style: { position: 'absolute', top: '100%', left: 0, marginTop: 6, zIndex: 60, minWidth: 280, background: '#fff', border: '1px solid #d9c6ff', borderRadius: 10, boxShadow: '0 10px 28px rgba(60,40,140,.18)', padding: 6, display: 'flex', flexDirection: 'column', gap: 4 } },
                h('button', { className: 'qqs-btn', style: { display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', padding: '8px 10px', justifyContent: 'flex-start', background: '#f3f0ff', borderColor: '#d0bfff' }, onClick: function () { setAddMenu(false); startBind() } },
                  h('span', { style: { fontSize: 20 } }, '📱'),
                  h('span', null,
                    h('b', { style: { color: '#171a21' } }, '扫码绑定新机器人'),
                    h('div', { style: { fontSize: 11, color: '#777' } }, '推荐 — 手机 QQ 扫码自动填凭据'))),
                h('button', { className: 'qqs-btn', style: { display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', padding: '8px 10px', justifyContent: 'flex-start' }, onClick: function () { setAddMenu(false); addBlank() } },
                  h('span', { style: { fontSize: 20 } }, '✍️'),
                  h('span', null,
                    h('b', { style: { color: '#171a21' } }, '手动新建账号'),
                    h('div', { style: { fontSize: 11, color: '#777' } }, '自己填写 AppID / AppSecret'))))
            : null)),
        h('div', { style: { ...sectionTitle, marginTop: 16, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' } },
          '② Agent 预设(人格库)',
          h('button', { className: 'qqs-btn', style: { fontSize: 12, padding: '2px 10px', borderColor: '#2b8a3e99', color: '#171a21' }, onClick: function () { setCopy({ fromStandard: true, sourceId: 'standard' }); setCopyId(''); setCopyName('') } }, '➕ 从标准模式新建(带QQ工具)')),
        h('p', { style: { fontSize: 12, color: '#888' } }, PRESET_HINT),
        h('p', { style: { fontSize: 12, color: '#364fc7', background: '#edf2ff', borderRadius: 6, padding: '6px 10px' } }, '💡 QQ 工具(send_media/发图等)现在由机器人会话自动挂载(2026-09-06 起), 不再依赖预设是否带标记——任意预设都能在 QQ 用; 「从标准模式新建」的副本仍会自带标记供识别。'),
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(190px,1fr))', gap: 10, margin: '8px 0' } },
          presets.map(function (p) {
            return h('div', { key: p.id, style: { border: '1px solid #00000026', borderRadius: 10, padding: '10px 12px', background: 'rgba(255,255,255,.5)' } },
              h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
                h('span', { style: { fontWeight: 800, color: '#171a21' } }, p.name),
                h('span', { style: { fontSize: 10, padding: '1px 6px', borderRadius: 8, color: '#fff', background: p.hasChannelTools ? '#2b8a3e' : '#5b9dff' } }, p.hasChannelTools ? 'QQ工具' : '会话自动挂载')),
              h('div', { style: { fontSize: 12, color: '#666', margin: '4px 0' } }, 'id=' + p.id),
              h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
                h('button', { className: 'qqs-btn', style: { padding: '2px 10px', fontSize: 12 }, onClick: function () { setCopy({ sourceId: p.id }); setCopyId(''); setCopyName('') } }, '复制'),
                h('button', { className: 'qqs-btn', style: { padding: '2px 10px', fontSize: 12, borderColor: '#1971c299' }, onClick: function () { openPresetEditor(p) } }, '✏️ 人格'),
                h('button', { className: 'qqs-btn', style: { padding: '2px 10px', fontSize: 12 }, onClick: function () { openPreset(p.id) } }, '📂 打开文件夹')))
          })),
        copy ? h('div', { style: { position: 'fixed', inset: 0, background: '#000c', zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center' }, onClick: function () { if (!busy) setCopy(null) } },
          h('div', { className: 'qqs-modal', style: { background: '#22252e', color: '#e8e8e8', borderRadius: 12, padding: 14, maxWidth: 460, width: '92%' }, onClick: function (e) { e.stopPropagation() } },
            h('h3', { style: { marginTop: 0 } }, copy.fromStandard ? '从标准模式新建预设' : '复制预设: ' + copy.sourceId),
            inputRow('预设 id(=新文件夹名, 字母/数字开头, 可含 - _): ', h('input', { className: 'qqs-inp', style: { width: '100%', boxSizing: 'border-box' }, value: copyId, onChange: function (e) { setCopyId(e.target.value) }, placeholder: '如 my-girl-2' })),
            inputRow('人设名(显示用, 中文随意): ', h('input', { className: 'qqs-inp', style: { width: '100%', boxSizing: 'border-box' }, value: copyName, onChange: function (e) { setCopyName(e.target.value) }, placeholder: '如 我的二号人格' })),
            h('div', { style: { textAlign: 'right', marginTop: 10 } },
              h('button', { className: 'qqs-btn', onClick: function () { if (!busy) setCopy(null) }, style: { marginRight: 8 } }, '取消'),
              h('button', { className: 'qqs-btn', onClick: doCopy, disabled: busy === 'copy' }, '生成新预设')))) : null,
        editP ? h('div', { style: { position: 'fixed', inset: 0, background: '#000c', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }, onClick: function () { if (!editBusy) setEditP(null) } },
          h('div', { className: 'qqs-modal', style: { background: '#1f232b', color: '#e8e8e8', borderRadius: 12, padding: 14, maxWidth: 760, width: '94%', maxHeight: '88vh', display: 'flex', flexDirection: 'column' }, onClick: function (e) { e.stopPropagation() } },
            h('h3', { style: { marginTop: 0 } }, '✏️ 人格编辑器 — ' + editP.name + ' (' + editP.id + ')'),
            h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', margin: '2px 0 6px', flexWrap: 'wrap' } },
              h('label', { style: { fontSize: 13 } }, '文件: '),
              h('select', { className: 'qqs-inp', style: { padding: '4px 8px', color: '#1f2329', maxWidth: 360 }, value: editFile, onChange: function (e) { pickEditFile(e.target.value) } },
                editFiles.map(function (fl) { return h('option', { key: fl.name, value: fl.name }, fl.name + ' (' + Math.max(1, Math.ceil(fl.size / 1024)) + 'KB)') })),
              h('span', { style: { fontSize: 12, color: editP.writable === false ? '#ffa94d' : '#7fd8a8' } }, editP.writable === false ? '🔒 只读(内置预设, 请先复制一份再改)' : (editP.writable ? '✅ 可编辑(你的副本)' : '⏳ 读取权限中…'))),
            h('p', { style: { fontSize: 12, color: '#9fb0c9', margin: '2px 0 6px' } }, '提示: agent.cordis.yml 里 persona 插件 config.text 就是人设正文; 直接整文件编辑, 保存后新会话生效。'),
            h('textarea', { className: 'qqs-inp', style: { width: '100%', boxSizing: 'border-box', flex: 1, minHeight: 300, fontFamily: 'ui-monospace,Consolas,monospace', fontSize: 12, lineHeight: 1.5, color: '#1f2329', whiteSpace: 'pre', resize: 'vertical', background: '#fff' }, value: editContent, readOnly: editP.writable === false, spellCheck: false, onChange: function (e) { setEditContent(e.target.value) } }),
            (editMsg ? h('p', { style: { fontSize: 12, color: '#ffa94d', margin: '4px 0' } }, editMsg) : null),
            h('div', { style: { textAlign: 'right', marginTop: 8 } },
              h('button', { className: 'qqs-btn', onClick: function () { if (!editBusy) setEditP(null) }, style: { marginRight: 8 } }, '关闭'),
              (editP.writable === false ? null : h('button', { className: 'qqs-btn', onClick: saveEditFile, disabled: editBusy || editP.writable === undefined, style: { borderColor: '#2f9e4499', color: '#171a21' } }, editBusy ? '保存中…' : '💾 保存')))))
        : null,
        bind ? h('div', { style: { position: 'fixed', inset: 0, background: '#000c', zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center' } },
          h('div', { className: 'qqs-modal', style: { background: '#22252e', color: '#e8e8e8', borderRadius: 12, padding: 14, maxWidth: 620, width: '94%' }, onClick: function (e) { e.stopPropagation() } },
            h('h3', { style: { marginTop: 0 } }, bind.status === 'error' ? '绑定失败' : '扫码绑定 QQ 机器人'),
            bind.status === 'error'
              ? h('p', { style: { color: '#ffa94d' } }, '失败: ' + (bind.error || '未知'))
              : h('div', null,
                h('p', { style: { fontSize: 13, color: '#cfd3dc' } }, '这个授权页只认「手机 QQ」打开(终端启动时是拿手机扫屏幕上的码 = 同一个链接)。请照做:'),
                h('ol', { style: { fontSize: 13, color: '#cfd3dc', margin: '4px 0 8px', paddingLeft: 20 } },
                  h('li', null, '点「复制链接」，把链接发到手机 QQ(如发给"文件传输助手")'),
                  h('li', null, '在手机 QQ 里点开链接，按页面提示完成机器人绑定(没有第二个机器人，就在页面里选/建一个)'),
                  h('li', null, '完成后本页自动收到并填好 AppID/AppSecret')),
                h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', background: '#ffffff12', border: '1px solid #ffffff26', borderRadius: 8, padding: '6px 8px' } },
                  h('span', { style: { flex: 1, fontSize: 11, color: '#9fb0c9', wordBreak: 'break-all', maxHeight: 60, overflow: 'auto' } }, bind.url),
                  h('button', { className: 'qqs-btn', onClick: function () { try { navigator.clipboard.writeText(bind.url).then(function () { setBind(function (o) { return o ? Object.assign({}, o, { copied: true }) : o }) }).catch(function () {}) } catch (e) {} } }, bind.copied ? '已复制 ✓' : '复制链接')),
                h('p', { style: { fontSize: 11, color: '#8a97ad' } }, '提示: 二维码内容就是这个链接——手机 QQ 扫电脑屏的码 = 在手机 QQ 里点开它, 效果相同。等待中…(过期会自动刷新, 重新复制最新链接即可)')),
            h('div', { style: { textAlign: 'right', marginTop: 8 } },
              h('button', { className: 'qqs-btn', onClick: cancelBind }, '取消绑定')))) : null,
        msg ? h('p', { style: { fontSize: 13, color: '#1d7a31', fontWeight: 600 } }, msg) : null,
        props && props.close ? h('button', { className: 'qqs-btn', onClick: props.close, style: { float: 'right', marginTop: 6 } }, '完成') : null)
    }

var QQS_CSS = ".qqs-btn{font:inherit;color:#333;background:linear-gradient(180deg,#ffffff,#f5f6f8);border:1px solid #d0d5dd;border-radius:9px;padding:5px 13px;cursor:pointer;transition:all .15s}.qqs-btn:hover{background:#ffffff;border-color:#7c6cf0;color:#7c6cf0}.qqs-btn:active{transform:translateY(1px)}.qqs-inp,.qqs-area{font:inherit;color:#1f2329;background:#ffffff;border:1px solid #d0d5dd;border-radius:9px;padding:5px 10px;outline:none;transition:border-color .15s}.qqs-inp::placeholder,.qqs-area::placeholder{color:#9aa1ab}.qqs-inp:focus,.qqs-area:focus{border-color:#7c6cf0;box-shadow:0 0 0 2px #7c6cf033}.qqs-cb{accent-color:#7c6cf0;width:15px;height:15px}.qqs-card{transition:box-shadow .15s,border-color .15s}.qqs-card:hover{box-shadow:0 2px 10px #0002}.qqs-panel{background:linear-gradient(180deg,#ffffff,#f7f8fa);border:1px solid #e2e5ea;border-radius:16px;padding:16px;box-shadow:0 10px 34px #0002}.qqs-toolbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;background:#f7f8fa;border:1px solid #e2e5ea;border-radius:12px;padding:8px 10px;margin-bottom:10px}.qqs-modal{background:#ffffff;color:#1f2329}"
    function ensureCss() { try { if (!document.getElementById('qqs-css')) { var st = document.createElement('style'); st.id = 'qqs-css'; st.textContent = QQS_CSS; document.head.appendChild(st) } } catch (e) {} }

    // ── 审批双通道 · Web 浮层(右下角小卡片) ──
    // 轮询 host 待办池(与 QQ 按钮/文本码共用同一 pending), 有点击即 POST 结算。
    // 原生 DOM 手写(不依赖 composer slot, 不与宿主原生审批面板打架), 2s 轮询够轻。
    var AP_FLOAT_CSS = "#qqs-ap-float{position:fixed;right:18px;bottom:84px;z-index:9999;width:min(340px,92vw);background:#fff;border:1px solid #d9c6ff;border-radius:14px;box-shadow:0 10px 34px rgba(80,40,140,.22);padding:0;overflow:hidden;font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif}#qqs-ap-float .ap-h{display:flex;align-items:center;gap:8px;padding:10px 14px;background:linear-gradient(90deg,#7c6cf01f,#7c6cf008);font-size:13px;font-weight:700;color:#4a3a9f;border-bottom:1px solid #efe8ff}#qqs-ap-float .ap-b{padding:10px 14px;font-size:13px;color:#1f2329}#qqs-ap-float .ap-b .ap-t{font-weight:600;margin-bottom:4px;word-break:break-all}#qqs-ap-float .ap-b .ap-r{color:#666;font-size:12px;margin-bottom:6px;word-break:break-all;max-height:60px;overflow:auto}#qqs-ap-float .ap-a{display:flex;gap:8px;padding:0 14px 12px}#qqs-ap-float .ap-a button{font:inherit;font-size:13px;font-weight:700;padding:7px 0;border-radius:9px;cursor:pointer;border:1px solid transparent;transition:opacity .15s}#qqs-ap-float .ap-a button:disabled{opacity:.5;cursor:default}#qqs-ap-float .ap-ok,.qqs-ap-float .ap-ok{background:#e6f7ec;color:#187a3d;border-color:#b8e6c8!important;flex:1}#qqs-ap-float .ap-no{background:#fdeeee;color:#c23131;border-color:#f3c4c4!important;flex:1}#qqs-ap-float .qs-opt{background:#f1ecff;color:#4a3a9f;border-color:#d9c6ff!important;text-align:left;padding:7px 12px;margin:2px 0;border-radius:9px;width:100%}#qqs-ap-float .ap-c{position:absolute;top:6px;right:10px;font-size:16px;color:#999;cursor:pointer;line-height:1}#qqs-ap-float .ap-done{color:#888;font-size:12px;padding:4px 14px 10px}";
    function ensureFloatCss() { try { if (!document.getElementById('qqs-ap-float-css')) { var st = document.createElement('style'); st.id = 'qqs-ap-float-css'; st.textContent = AP_FLOAT_CSS; document.head.appendChild(st) } } catch (e) {} }
    function fmtDeadline(ts) {
      var left = Math.max(0, Math.ceil((ts - Date.now()) / 1000))
      return left > 60 ? Math.ceil(left / 60) + ' 分钟' : left + ' 秒'
    }
    function startApprovalFloat() {
      try { ensureFloatCss() } catch (e) { return }
      var lastKey = ''
      var busy = false
      var hidden = false
      var root = null
      var itemType = '' // 'ap' 审批 | 'qs' 提问

      function show(kind, titleHtml, bodyHtml, actionHtml) {
        if (!root) {
          root = document.createElement('div')
          root.id = 'qqs-ap-float'
          document.body.appendChild(root)
        }
        root.style.display = hidden ? 'none' : 'block'
        itemType = kind
        lastKey = kind + ':' + keyOf(kind)
        root.innerHTML =
          '<div class="ap-h"><span>' + titleHtml + '</span><span style="flex:1"></span><span class="ap-c" title="关闭">✕</span></div>'
          + bodyHtml + actionHtml
          + '<div class="ap-done" style="display:none">已处理 ✓</div>'
        root.querySelector('.ap-c').onclick = function () { root.style.display = 'none'; hidden = true }
      }
      function keyOf(kind) {
        if (kind === 'ap') return (curAp && (curAp.ns + ':' + curAp.code)) || ''
        return (curQs && (curQs.ns + ':' + curQs.key)) || ''
      }
      function doneMsg(m) {
        if (!root) return
        var a = root.querySelector('.ap-a'); if (a) a.style.display = 'none'
        var d = root.querySelector('.ap-done')
        if (d) { d.style.display = 'block'; d.textContent = m || '已处理 ✓' }
        setTimeout(function () { if (root) root.style.display = 'none' }, 1800)
      }

      // ── 审批卡片渲染 ──
      var curAp = null
      function renderAp(list) {
        if (itemType && itemType !== 'ap' && !list.length) return
        var ap = list[0]
        if (!ap) { if (itemType === 'ap') { if (root) root.style.display = 'none' }; curAp = null; return }
        curAp = ap
        var k = ap.ns + ':' + ap.code
        if (itemType === 'ap' && k === lastKey) return
        hidden = false
        show('ap', '⚠️ DSH 权限申请',
          '<div class="ap-b"><div class="ap-t">工具：' + esc(ap.toolName || '?')
          + '</div>' + (ap.reason ? '<div class="ap-r">' + esc(ap.reason) + '</div>' : '')
          + '<div style="font-size:11px;color:#999">' + esc(ap.ownerHint || '') + ' · ' + fmtDeadline(ap.deadlineAt) + ' 后自动拒绝 · 共 ' + list.length + ' 条</div></div>',
          '<div class="ap-a">'
          + '<button class="ap-ok" data-act="allow">✅ 允许</button>'
          + '<button class="ap-no" data-act="deny">❌ 拒绝</button>'
          + '</div>')
        bindApButtons(ap)
      }
      function bindApButtons(ap) {
        if (!root) return
        root.querySelectorAll('.ap-a button').forEach(function (btn) {
          btn.onclick = function () {
            if (busy) return
            busy = true
            var act = btn.getAttribute('data-act')
            btn.disabled = true
            fetch('/api/qqbot-settings/approval/decide', {
              method: 'POST', headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ code: ap.code, act: act }),
            }).then(function (r) { return r.json().catch(function () { return null }) }).then(function (d) {
              busy = false; lastKey = ''
              doneMsg((d && d.msg) || (act === 'allow' ? '已允许 ✓' : '已拒绝 ✓'))
            }).catch(function () { busy = false; btn.disabled = false })
          }
        })
      }

      // ── 提问卡片渲染(选项逐个列出, 点击即答) ──
      var curQs = null
      function renderQs(list) {
        if (itemType && itemType !== 'qs' && !list.length) return
        var q = list[0]
        if (!q) { if (itemType === 'qs') { if (root) root.style.display = 'none' }; curQs = null; return }
        curQs = q
        var k = q.ns + ':' + q.key
        if (itemType === 'qs' && k === lastKey) return
        hidden = false
        var optBtns = (q.options || []).map(function (o, i) {
          return '<button class="qs-opt" data-i="' + i + '">' + esc(String(o.label || '').slice(0, 40)) + '</button>'
        }).join('')
        show('qs', '❓ 远程提问',
          '<div class="ap-b">' + (q.header ? '<div class="ap-t">' + esc(q.header) + '</div>' : '')
          + '<div class="ap-t">' + esc(q.question || '') + '</div>'
          + (q.detail ? '<div class="ap-r">' + esc(q.detail) + '</div>' : '')
          + '<div style="font-size:11px;color:#999">' + fmtDeadline(q.deadlineAt) + ' 后失效 · 共 ' + list.length + ' 条</div></div>',
          '<div class="ap-a" style="flex-direction:column;align-items:stretch">' + optBtns + '</div>')
        bindQsButtons(q)
      }
      function bindQsButtons(q) {
        if (!root) return
        root.querySelectorAll('.qs-opt').forEach(function (btn) {
          btn.onclick = function () {
            if (busy) return
            busy = true
            var i = Number(btn.getAttribute('data-i'))
            btn.disabled = true
            fetch('/api/qqbot-settings/questions/decide', {
              method: 'POST', headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ key: q.key, optIdx: i }),
            }).then(function (r) { return r.json().catch(function () { return null }) }).then(function (d) {
              busy = false; lastKey = ''
              doneMsg((d && d.msg) || '已选择 ✓')
            }).catch(function () { busy = false; btn.disabled = false })
          }
        })
      }

      function poll() {
        if (busy) return
        try {
          fetch('/api/qqbot-settings/approval/pending').then(function (r) { return r.json().catch(function () { return null }) }).then(function (d) {
            if (d && Array.isArray(d.pending)) renderAp(d.pending)
            else if (itemType === 'ap' && d && !d.ok) { if (root) root.style.display = 'none'; itemType = '' }
          }).catch(function () {})
          fetch('/api/qqbot-settings/questions/pending').then(function (r) { return r.json().catch(function () { return null }) }).then(function (d) {
            if (d && Array.isArray(d.pending)) renderQs(d.pending)
            else if (itemType === 'qs' && d && !d.ok) { if (root) root.style.display = 'none'; itemType = '' }
          }).catch(function () {})
        } catch (e) {}
      }
      poll()
      setInterval(poll, 2000)
    }

    // ══ 群管理悬浮球 dock(可拖拽; 点开=群管理悬浮台; 关闭收回成球) ══
    // 与审批浮层同款: 原生 DOM 手写挂 body, 全页面可用, 不与宿主 slots 打架。
    // 三类提示的分工(主人 2026-09-06 定):
    //   · 审批/提问 → 打断式弹出(#qqs-ap-float 保持)
    //   · 入群申请 → 悬浮球上安静红点(不弹窗)
    //   · 群管理(发消息/审批入群/禁言) → 悬浮球点开成操作台
    var DOCK_CSS = "#qqs-dock-wrap{position:fixed;right:18px;bottom:190px;z-index:9997;font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif}#qqs-dock-ball{width:52px;height:52px;border-radius:50%;background:linear-gradient(160deg,#7c6cf0,#5b4fd8);color:#fff;font-size:24px;line-height:52px;text-align:center;cursor:pointer;box-shadow:0 6px 20px rgba(90,70,220,.4);user-select:none;transition:transform .12s,box-shadow .12s;position:relative}#qqs-dock-ball:hover{transform:scale(1.06)}#qqs-dock-badge{position:absolute;top:-4px;right:-4px;min-width:18px;height:18px;border-radius:9px;background:#ff4d4f;color:#fff;font-size:11px;font-weight:700;line-height:18px;padding:0 4px;box-sizing:border-box;text-align:center;display:none}#qqs-dock-panel{position:fixed;right:18px;bottom:190px;z-index:9998;width:min(720px,94vw);max-height:68vh;display:none;flex-direction:column;background:#fff;border:1px solid #d9c6ff;border-radius:16px;box-shadow:0 12px 40px rgba(60,40,140,.25);overflow:hidden;font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif}#qqs-dock-panel .dk-h{display:flex;align-items:center;gap:8px;padding:10px 14px;background:linear-gradient(90deg,#7c6cf01f,#7c6cf008);font-size:14px;font-weight:700;color:#4a3a9f;border-bottom:1px solid #efe8ff}#qqs-dock-panel .dk-b{padding:10px 14px;overflow:auto;font-size:13px;color:#1f2329}#qqs-dock-panel .dk-tab{display:flex;gap:4px;border-bottom:1px solid #eee;margin-bottom:10px}#qqs-dock-panel .dk-tab button{font:inherit;font-size:13px;padding:6px 14px;border:none;background:none;cursor:pointer;color:#666;border-bottom:2px solid transparent}#qqs-dock-panel .dk-tab button.on{color:#4a3a9f;font-weight:700;border-bottom-color:#7c6cf0}#qqs-dock-panel select.qqs-sel,#qqs-dock-panel input.qqs-txt,#qqs-dock-panel textarea.qqs-txt{font:inherit;color:#1f2329;background:#fff;border:1px solid #d0d5dd;border-radius:8px;padding:5px 8px;outline:none}#qqs-dock-panel .dk-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:6px 0}#qqs-dock-panel .dk-btn{font:inherit;font-size:13px;padding:5px 12px;border-radius:8px;cursor:pointer;border:1px solid #d9c6ff;background:#f1ecff;color:#4a3a9f}#qqs-dock-panel .dk-btn.ok{background:#e6f7ec;color:#187a3d;border-color:#b8e6c8}#qqs-dock-panel .dk-btn.no{background:#fdeeee;color:#c23131;border-color:#f3c4c4}#qqs-dock-panel .dk-btn:disabled{opacity:.5;cursor:default}#qqs-dock-panel .dk-msg{color:#888;font-size:12px;padding:2px 0}#qqs-dock-panel .dk-list{max-height:34vh;overflow:auto;border:1px solid #f0ecff;border-radius:10px;padding:4px}#qqs-dock-panel .dk-item{display:flex;align-items:center;gap:8px;padding:6px 8px;border-bottom:1px solid #f5f2ff;flex-wrap:wrap;font-size:13px}#qqs-dock-panel .dk-item:last-child{border-bottom:none}#qqs-dock-panel .dk-empty{color:#aaa;text-align:center;padding:18px 0;font-size:12px}"
    // ── 💬 聊天视图样式(dock 追加段, 2026-09-07): QQ 风格气泡, 群友左(bot)右 ──
    var DOCK_CSS2 = "#qqs-dock-panel .dk-chat-head{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:0 0 6px}#qqs-dock-panel .dk-chat-box{overflow-y:auto;overscroll-behavior:contain;background:#f5f6f8;border:1px solid #e6e8ec;border-radius:10px;padding:10px 12px;box-sizing:border-box;height:min(36vh,300px);min-height:140px;scroll-behavior:auto}#qqs-dock-panel .dk-chat-box::-webkit-scrollbar{width:6px}#qqs-dock-panel .dk-chat-box::-webkit-scrollbar-thumb{background:#d3d7dd;border-radius:3px}#qqs-dock-panel .dk-crow{display:flex;gap:8px;align-items:flex-start;margin:0 0 12px}#qqs-dock-panel .dk-crow.out{flex-direction:row-reverse}#qqs-dock-panel .dk-ava{width:32px;height:32px;border-radius:50%;flex:none;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:600;color:#fff;overflow:hidden;user-select:none;background:linear-gradient(150deg,#8fb3e8,#5f8fd9)}#qqs-dock-panel .dk-crow.out .dk-ava{background:linear-gradient(150deg,#5ec7f2,#3b8fe0)}#qqs-dock-panel .dk-cmain{display:flex;flex-direction:column;max-width:calc(100% - 40px);min-width:0}#qqs-dock-panel .dk-crow.in .dk-cmain{align-items:flex-start}#qqs-dock-panel .dk-crow.out .dk-cmain{align-items:flex-end}#qqs-dock-panel .dk-cmeta{font-size:11px;color:#9aa0a8;margin:0 6px 2px;max-width:100%;display:flex;align-items:center;gap:5px;flex-wrap:wrap}#qqs-dock-panel .dk-crow.out .dk-cmeta{flex-direction:row-reverse}#qqs-dock-panel .dk-cbubble{padding:7px 11px;font-size:13px;line-height:1.55;white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere;box-shadow:0 1px 2px rgba(20,30,60,.06);max-width:100%}#qqs-dock-panel .dk-cbubble a.dk-link{color:#1a66d6;text-decoration:underline;word-break:break-all;cursor:pointer}#qqs-dock-panel .dk-crow.out .dk-cbubble a.dk-link{color:#eaf3ff}#qqs-dock-panel .dk-crow.in .dk-cbubble{background:#fff;border:1px solid #e3e6ea;color:#1f2329;border-radius:3px 10px 10px 10px}#qqs-dock-panel .dk-crow.out .dk-cbubble{background:linear-gradient(180deg,#69a6ff,#3d7df5);color:#fff;border-radius:10px 3px 10px 10px}#qqs-dock-panel .dk-img{display:block;max-width:min(230px,52vw);max-height:200px;border-radius:6px;margin:0 0 3px;object-fit:cover;cursor:zoom-in}#qqs-dock-panel .dk-audio{display:block;max-width:min(260px,60vw);width:100%;height:34px;margin:0 0 2px}#qqs-dock-panel .dk-file{display:inline-flex;align-items:center;gap:5px;max-width:100%;padding:6px 12px;border-radius:8px;background:#f0f6ff;border:1px solid #cfe0fa;color:#2b6bd8;font-size:13px;text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}#qqs-dock-panel .dk-file:hover{background:#e2edff}#qqs-dock-panel .dk-video{display:block;max-width:min(260px,60vw);max-height:180px;border-radius:6px;margin:0 0 2px}#qqs-dock-panel .dk-ctag{display:inline-block;font-size:10px;color:#5b8ff0;background:#eaf2ff;border:1px solid #d4e3fd;border-radius:8px;padding:0 6px}#qqs-dock-panel .dk-chat-top{text-align:center;color:#b0b4bb;font-size:11px;padding:2px 0 6px;user-select:none}#qqs-dock-panel .dk-chat-bottom{text-align:center;color:#c3c7cd;font-size:11px;padding:6px 0 0}#qqs-dock-panel .dk-composer{margin-top:8px;border:1px solid #e3e6ea;border-radius:10px;background:#fff;overflow:visible}#qqs-dock-panel .dk-composer textarea{width:100%;box-sizing:border-box;border:none;outline:none;resize:none;font:inherit;font-size:13px;color:#1f2329;background:transparent;padding:8px 10px 4px;line-height:1.5;max-height:120px}#qqs-dock-panel .dk-cbar{display:flex;align-items:center;gap:4px;padding:4px 8px 6px;flex-wrap:wrap}#qqs-dock-panel .dk-cbar .dk-btn{padding:3px 10px;font-size:12px;border-radius:7px}#qqs-dock-panel .dk-cbar .dk-send{background:linear-gradient(180deg,#69a6ff,#3d7df5);color:#fff;border:none;border-radius:8px;padding:5px 18px;font-size:13px;font-weight:600;cursor:pointer}#qqs-dock-panel .dk-cbar .dk-send:disabled{opacity:.5;cursor:default}#qqs-lightbox{position:fixed;inset:0;z-index:2147483000;background:rgba(8,10,18,.82);display:flex;align-items:center;justify-content:center;cursor:zoom-out}#qqs-lightbox img{max-width:92vw;max-height:92vh;border-radius:8px;box-shadow:0 10px 60px rgba(0,0,0,.6)}#qqs-dock-panel .dk-composer{position:relative}#qqs-dock-panel .dk-at-pop{position:absolute;left:6px;bottom:calc(100% - 4px);z-index:30;min-width:200px;max-width:90%;max-height:190px;overflow-y:auto;background:#fff;border:1px solid #e0e4ea;border-radius:10px;box-shadow:0 8px 24px rgba(30,40,80,.16);padding:4px;display:none}#qqs-dock-panel .dk-at-item{display:flex;align-items:center;gap:6px;padding:5px 9px;border-radius:7px;cursor:pointer;font-size:12px;color:#1f2329;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#qqs-dock-panel .dk-at-item.on,#qqs-dock-panel .dk-at-item:hover{background:#eef3ff;color:#2b5fd0}#qqs-dock-panel .dk-at-empty{color:#aaa;font-size:12px;padding:6px 9px}#qqs-lightbox .lb-x{position:fixed;right:16px;top:10px;color:#fff;font-size:30px;cursor:pointer;line-height:1;padding:6px}#qqs-dock-panel.dk-full{left:0!important;top:0!important;right:0!important;bottom:0!important;width:100vw!important;max-width:100vw!important;height:100vh!important;max-height:100vh!important;border-radius:0;z-index:2147482000;display:flex;flex-direction:column}#qqs-dock-panel.dk-full .dk-h,#qqs-dock-panel.dk-full .dk-detect{flex:none}#qqs-dock-panel.dk-full .dk-b{flex:1;min-height:0;overflow:hidden;display:flex;flex-direction:column;padding:8px 14px 6px}#qqs-dock-panel.dk-full .dk-chat-wrap{display:flex;flex-direction:column;flex:1;min-height:0}#qqs-dock-panel.dk-full .dk-chat-head{flex:none}#qqs-dock-panel.dk-full .dk-chat-box{flex:1;height:auto!important;min-height:0!important;max-height:none!important;overflow-y:auto;overscroll-behavior:contain}#qqs-dock-panel.dk-full .dk-composer{flex:none;margin-top:6px}"
    function ensureDockCss2() { try { if (!document.getElementById('qqs-dock-css2')) { var st = document.createElement('style'); st.id = 'qqs-dock-css2'; st.textContent = DOCK_CSS2; document.head.appendChild(st) } } catch (e) {} };
    function ensureDockCss() { try { if (!document.getElementById('qqs-dock-css')) { var st = document.createElement('style'); st.id = 'qqs-dock-css'; st.textContent = DOCK_CSS; document.head.appendChild(st) } } catch (e) {} }
    function startQqDock(sessionsSvc) {
      try { ensureDockCss() } catch (e) { return }
      try { ensureDockCss2() } catch (e) {}
      // 幂等(2026-09-07): 宿主重启/client 重连若触发重复初始化, 先移除旧 dock 再建, 保证始终只有一个悬浮球
      var oldWrap = document.getElementById('qqs-dock-wrap')
      if (oldWrap) { try { oldWrap.remove() } catch (e) { if (oldWrap.parentNode) oldWrap.parentNode.removeChild(oldWrap) } }
      // 位置记忆(可拖拽)
      var pos = null; try { var raw = localStorage.getItem('qqs-dock-pos'); if (raw) pos = JSON.parse(raw) } catch (e) {}
      var wrap = document.createElement('div')
      wrap.id = 'qqs-dock-wrap'
      wrap.innerHTML = '<div id="qqs-dock-ball" title="QQ 群管理(拖拽移动, 点开面板)">🛡<span id="qqs-dock-badge">0</span></div>'
      document.body.appendChild(wrap)
      var ball = wrap.querySelector('#qqs-dock-ball')
      var badge = wrap.querySelector('#qqs-dock-badge')
      var panel = null
      var open = false
      if (pos) { wrap.style.left = pos.x + 'px'; wrap.style.top = pos.y + 'px'; wrap.style.right = 'auto'; wrap.style.bottom = 'auto' }
      // 拖拽(球上按住移动; 单击与拖拽区分)
      var dragState = null
      ball.addEventListener('mousedown', function (e) {
        dragState = { sx: e.clientX, sy: e.clientY, ox: wrap.offsetLeft, oy: wrap.offsetTop, moved: false }
        e.preventDefault()
      })
      document.addEventListener('mousemove', function (e) {
        if (!dragState) return
        var dx = e.clientX - dragState.sx, dy = e.clientY - dragState.sy
        if (Math.abs(dx) + Math.abs(dy) > 3) dragState.moved = true
        if (!dragState.moved) return
        wrap.style.left = Math.max(0, Math.min(window.innerWidth - 60, dragState.ox + dx)) + 'px'
        wrap.style.top = Math.max(0, Math.min(window.innerHeight - 60, dragState.oy + dy)) + 'px'
        wrap.style.right = 'auto'; wrap.style.bottom = 'auto'
        syncPanelPos()
      })
      document.addEventListener('mouseup', function (e) {
        if (!dragState) return
        var moved = dragState.moved
        dragState = null
        if (moved) {
          try { localStorage.setItem('qqs-dock-pos', JSON.stringify({ x: wrap.offsetLeft, y: wrap.offsetTop })) } catch (err) {}
        }
        if (moved && e.target === ball) return
      })
      function syncPanelPos() {
        if (!panel || !open) return
        layoutPanel()
      }
      // ── 面板自适应定位: 按悬浮球屏幕位置翻转展开方向, 边缘 clamp 保证完整可见 ──
      var lastBallRect = null
      var manualPanelPos = null // 手动拖过面板后固定位置(不再自动贴球)
      function layoutPanel() {
        if (!panel || !open) return
        var vw = window.innerWidth, vh = window.innerHeight
        var pad = 10
        // 手动拖拽固定位置: 保持并 clamp
        if (manualPanelPos) {
          var pw2 = panel.offsetWidth || Math.min(720, vw * 0.94)
          var ph2 = panel.offsetHeight || Math.round(vh * 0.68)
          panel.style.left = Math.max(pad, Math.min(manualPanelPos.x, vw - pw2 - pad)) + 'px'
          panel.style.top = Math.max(pad, Math.min(manualPanelPos.y, vh - ph2 - pad)) + 'px'
          panel.style.right = 'auto'
          panel.style.bottom = 'auto'
          panel.style.maxHeight = Math.round(vh - pad * 2) + 'px'
          return
        }
        if (!lastBallRect) { lastBallRect = { left: vw - 70, top: vh - 80, right: vw - 18, bottom: vh - 28, width: 52, height: 52 } }
        var pw = panel.offsetWidth || Math.min(720, vw * 0.94)
        var ph = Math.min(panel.offsetHeight || Math.round(vh * 0.68), vh - pad * 2)
        // 水平: 右侧放不下 → 向左展开; 左侧放不下 → 向右展开; 再整体 clamp
        var left
        if (lastBallRect.right + pad + pw <= vw - pad) left = lastBallRect.right + pad
        else if (lastBallRect.left - pad - pw >= pad) left = lastBallRect.left - pad - pw
        else left = (lastBallRect.left + lastBallRect.width / 2) > vw / 2 ? vw - pw - pad : pad
        left = Math.max(pad, Math.min(left, vw - pw - pad))
        // 垂直: 下方放不下 → 向上展开
        var top
        if (lastBallRect.bottom + pad + ph <= vh - pad) top = lastBallRect.bottom + pad
        else if (lastBallRect.top - pad - ph >= pad) top = lastBallRect.top - pad - ph
        else top = vh - ph - pad
        top = Math.max(pad, Math.min(top, vh - ph - pad))
        panel.style.left = Math.round(left) + 'px'
        panel.style.top = Math.round(top) + 'px'
        panel.style.right = 'auto'
        panel.style.bottom = 'auto'
        // 面板超高时内部滚动, 头/关闭按钮始终可见
        panel.style.maxHeight = Math.round(vh - pad * 2) + 'px'
      }
      // 展开态拖拽: 按住面板头部(.dk-h 非控件区)移动整个 dock 面板
      function bindPanelDrag() {
        if (!panel || !open) return
        var h = panel.querySelector('.dk-h')
        if (!h) return
        h.onmousedown = function (e) {
          if (e.button !== 0) return
          var t = e.target
          if (t && t.closest && t.closest('button,select,input,textarea,a,.qqs-sel,.qqs-txt')) return
          e.preventDefault()
          var sx = e.clientX, sy = e.clientY
          var ox = panel.offsetLeft, oy = panel.offsetTop
          var moved = false
          var mm = function (ev) {
            var dx = ev.clientX - sx, dy = ev.clientY - sy
            if (Math.abs(dx) + Math.abs(dy) > 2) moved = true
            panel.style.left = (ox + dx) + 'px'
            panel.style.top = (oy + dy) + 'px'
            panel.style.right = 'auto'
            panel.style.bottom = 'auto'
          }
          var mu = function () {
            document.removeEventListener('mousemove', mm)
            document.removeEventListener('mouseup', mu)
            if (moved) manualPanelPos = { x: panel.offsetLeft, y: panel.offsetTop }
          }
          document.addEventListener('mousemove', mm)
          document.addEventListener('mouseup', mu)
        }
        // 双击头部 → 取消手动固定, 恢复自动贴球定位
        h.ondblclick = function (e) {
          var t = e.target
          if (t && t.closest && t.closest('button,select,input,textarea,a')) return
          manualPanelPos = null
          layoutPanel()
        }
      }
      function closePanel() {
        open = false
        if (panel) { panel.style.display = 'none'; panel.innerHTML = '' }
        ball.style.display = 'block'
      }
      function togglePanel() {
        if (dragState && dragState.moved) return
        if (open) { closePanel(); return }
        if (!panel) {
          panel = document.createElement('div')
          panel.id = 'qqs-dock-panel'
          document.body.appendChild(panel)
        }
        open = true
        // 先量球位置(隐藏前), 再隐藏球
        var wr = wrap.getBoundingClientRect()
        lastBallRect = { left: wr.left, top: wr.top, right: wr.right, bottom: wr.bottom, width: wr.width, height: wr.height }
        ball.style.display = 'none'
        panel.style.display = 'flex'
        panel.style.left = 'auto'; panel.style.top = 'auto'; panel.style.right = 'auto'; panel.style.bottom = 'auto'
        renderPanel()
        // 等一帧内容渲染完再定位(offsetWidth/offsetHeight 才准确)
        setTimeout(layoutPanel, 0)
      }
      ball.addEventListener('click', togglePanel)
      // Esc 或点击面板外 → 收回成球
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && open) closePanel() })
      document.addEventListener('mousedown', function (e) {
        if (!open) return
        // 灯箱(#qqs-lightbox)是浮在 dock 外的全屏层: 点它(关闭放大)不能把 dock 也收走
        if (e.target && e.target.closest && e.target.closest('#qqs-lightbox')) return
        if (panel && (panel.contains(e.target) || panel === e.target)) return
        if (wrap && (wrap.contains(e.target) || wrap === e.target)) return
        closePanel()
      })
      function esc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') }
      function api(path, q) {
        var url = '/api/qqbot-settings/' + path + (q ? '?' + q : '')
        return fetch(url).then(function (r) { return r.json().catch(function () { return null }) }).catch(function () { return null })
      }
      function apiPost(path, body) {
        return fetch('/api/qqbot-settings/' + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) })
          .then(function (r) { return r.json().catch(function () { return null }) }).catch(function () { return null })
      }
      // ── 红点: 入群申请待审汇总(各实例 pending 数之和, 不弹窗) ──
      function refreshBadge() {
        api('group/join-summary').then(function (d) {
          if (!d || !d.ok || !Array.isArray(d.items)) return
          var n = 0
          d.items.forEach(function (it) { n += (it.pending || 0) })
          if (n > 0) { badge.style.display = 'block'; badge.textContent = n > 99 ? '99+' : String(n) }
          else badge.style.display = 'none'
          if (panel && open) { var b = panel.querySelector('.dk-join-badge'); if (b) b.style.display = n > 0 ? 'inline-block' : 'none'; if (b) b.textContent = n > 99 ? '99+' : String(n) }
        })
      }
      refreshBadge()
      setInterval(refreshBadge, 20000)

      // ── 面板状态(每个实例独立保存, 切回不丢) ──
      var state = { ns: '', accts: [], gid: '', groups: [], tab: 'chat', sendScope: 'group', sendTo: '', sendName: '', sendText: '', insertCtx: true, targetQ: '', c2cs: [], joins: null, mutes: null, members: null, muteSecs: '60', bindGid: '', bindName: '', msg: '', busy: '', wantPeer: null, lookedUp: false, detected: null, detectedHit: null, chatItems: [], chatMore: false, chatBusy: '', chatErr: '', chatOldest: 0, chatText: '', chatIns: true, outMode: '', outRev: undefined, bpEvents: [], bpSel: null, bpDraft: null, rosterSel: {}, rosterScope: 'all', rosterQ: '', hubSid: '', hubRev: undefined, hubBusy: '', hubMsg: '', gaEnabled: false, gaPoll: false, gaPollWake: true, gaHubNotify: true, gaNotifyGroup: true, gaInterval: 5, gaMinCount: 1, gaMsg: '', gaBusy: '', bcDraft: null, bcTasks: null, cardMd: '', cardBtns: '', cardGid: '', cardBusy: '', cardQ: '', tgGroups: [], tgCur: '' }
      // 🗂 自定义目标分组(仿 QQ 分组): 2026-09-12 起**host 持久化**({dataRoot}/.qqbot/target-groups.json),
      // localStorage 只当秒开缓存 —— 这样 **AI 与主人共用同一份分组**(agent 侧 broadcast_send 可直接写分组名群发),
      // 顺带修掉"换个浏览器分组就没了"的老毛病。
      // 结构: [{ id, name, members: ['group:xxx' | 'c2c:yyy', ...] }]
      try {
        var _tg = localStorage.getItem('qqs-target-groups')
        if (_tg) { var _tgo = JSON.parse(_tg); if (Array.isArray(_tgo)) state.tgGroups = _tgo }
      } catch (e) {}
      function saveTgGroups() {
        try { localStorage.setItem('qqs-target-groups', JSON.stringify(state.tgGroups || [])) } catch (e) {}
        // 同步 host(与 AI 共用); 失败不影响本地缓存与当前操作
        try {
          fetch(api('group/target-groups'), {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ns: state.ns || undefined, groups: state.tgGroups || [] }),
          }).catch(function () {})
        } catch (e) {}
      }
      function loadTgGroupsFromHost() {
        fetch(api('group/target-groups' + (state.ns ? '?ns=' + encodeURIComponent(state.ns) : '')), { cache: 'no-store' })
          .then(function (r) { return r.json() }).then(function (d) {
            if (!d || !d.ok) return
            var host = Array.isArray(d.groups) ? d.groups : []
            var local = Array.isArray(state.tgGroups) ? state.tgGroups : []
            if (host.length === 0) {
              if (local.length > 0) saveTgGroups() // 迁移: 本地有、host 还空 → 推上去(第一次打开新版时发生一次)
            } else if (local.length === 0) {
              state.tgGroups = host
              try { localStorage.setItem('qqs-target-groups', JSON.stringify(host)) } catch (e) {}
            } else {
              // 两边都非空 → **按 id 合并并集**: host 打底(以它为准), 本地**独有的组保留**, 同 id 取成员多的一份。
              // 旧实现是"host 有数据就整体覆盖本地" → 会把本地刚建好、还没同步成功的分组凭空冲掉(2026-09-12 修)。
              var byId = {}, order = []
              var put = function (g, localWinsIfMore) {
                if (!g || !g.id) return
                var old = byId[g.id]
                if (!old) { byId[g.id] = g; order.push(g.id); return }
                var a = (old.members || []).length, b = (g.members || []).length
                if (localWinsIfMore ? b > a : b >= a) byId[g.id] = g
              }
              host.forEach(function (g) { put(g, false) })
              local.forEach(function (g) { put(g, true) })
              var merged = order.map(function (id) { return byId[id] })
              state.tgGroups = merged
              try { localStorage.setItem('qqs-target-groups', JSON.stringify(merged)) } catch (e) {}
              if (JSON.stringify(merged) !== JSON.stringify(host)) saveTgGroups() // 合并结果 ≠ host → 推回, 让 AI 与主人看到同一份
            }
            if (state.tab === 'roster' || state.tab === 'broadcast') paintBody()
          }).catch(function () {})
      }
      // 📇 群组管理 M1: 勾选集合本地持久化(刷新/重开不丢, 供后续群发/批量操作使用)
      try { var _rs = localStorage.getItem('qqs-roster-sel'); if (_rs) { var _rso = JSON.parse(_rs); if (_rso && typeof _rso === 'object') state.rosterSel = _rso } } catch (e) {}
      var chatFlash = '' // 发送结果/错误提示(短时展示, 不被列表计数覆盖)
      // @ mention(输入框敲 @ 弹成员候选): 群聊目标才启用
      var atM = { members: [], open: false, kw: '', idx: 0, range: null, key: '' }
      function loadAccts() {
        api('accounts').then(function (d) {
          var list = (d && Array.isArray(d.instances) ? d.instances : []).filter(function (a) { return !a.disabled })
          state.accts = list
          if (list.length && !state.ns) {
            // 优先跟随 web 当前会话绑定的 QQ 目标(session-lookup); 未命中才回落到第一个实例
            reDetectAndSelect()
          } else if (list.length && state.ns) { /* 保持 */ paintHead(); paintDetect() } else { state.ns = ''; paintHead(); paintDetect() }
        })
      }
      // 读 web 当前会话(sessionId)并反查它是否挂在某个 qqbot 的群/私聊上
      // 权威源优先: ctx.sessions.list.getSnapshot().current(宿主官方, agent id === session id);
      // 兜底: localStorage 'dsh.sessions.current'(宿主持久化镜像, 每次切换实时写)。
      function readCurrentSessionId() {
        try {
          if (sessionsSvc && sessionsSvc.list && typeof sessionsSvc.list.getSnapshot === 'function') {
            var snap = sessionsSvc.list.getSnapshot()
            if (snap && snap.current) { state.detected = { src: 'sessions.list', sid: snap.current, title: (snap.byId && snap.byId[snap.current] && (snap.byId[snap.current].displayTitle || snap.byId[snap.current].title)) || '' }; return snap.current }
          }
        } catch (e) {}
        try { var raw = localStorage.getItem('dsh.sessions.current'); if (raw) { var o = JSON.parse(raw); if (o && o.sessionId) { state.detected = { src: 'localStorage', sid: o.sessionId, title: '' }; return o.sessionId } } } catch (e) {}
        state.detected = { src: 'none', sid: '', title: '' }
        return ''
      }
      function lookupCurrentSession(cb) {
        var sid = readCurrentSessionId()
        if (!sid) { cb(null); return }
        api('session-lookup', 'sessionId=' + encodeURIComponent(sid)).then(function (d) {
          if (d && d.ok && Array.isArray(d.hits) && d.hits.length) {
            state.detectedHit = d.hits[0]
            cb(d.hits[0])
            return
          }
          state.detectedHit = null
          cb(null)
        }).catch(function () { state.detectedHit = null; cb(null) })
      }
      function curDataDir() {
        var ac = null; state.accts.forEach(function (a) { if (a.ns === state.ns) ac = a })
        return ac ? (ac.dataDir || '') : ''
      }
      function outNsQ() { return state.ns ? 'ns=' + encodeURIComponent(state.ns) : '' }
      // ⚙ 单会话设置 · 智能回复(本地小模型; 2026-09-13 主人定, 15:2x 改名)
      // 📊 评分列表 HTML(单独抽出: 供"局部刷新"只替换内容, 不整块重绘)
      function scoreListHtml(vs) {
        if (vs === undefined || vs === null) return '<div class="dk-empty" style="padding:8px 0">读取中…</div>'
        if (!vs.items || !vs.items.length) return '<div class="dk-empty" style="padding:8px 0">还没有记录 —— 群里有人说句话之后, 这里会列出每条消息的分数</div>'
        var out = '<div style="max-height:230px;overflow:auto;border:1px solid #eee;border-radius:6px">'
        vs.items.slice().reverse().forEach(function (it) {
          var tt = new Date(it.ts || 0)
          var hh = ('0' + tt.getHours()).slice(-2) + ':' + ('0' + tt.getMinutes()).slice(-2) + ':' + ('0' + tt.getSeconds()).slice(-2)
          var col = it.worth ? '#2f9e44' : '#c23131'
          out += '<div style="padding:4px 8px;border-bottom:1px solid #f5f5f5;font-size:12px">'
            + '<span style="color:#999">' + hh + '</span> '
            + '<b style="color:' + col + '">' + (typeof it.score === 'number' ? it.score.toFixed(2) : (it.img ? '📷' : '-')) + '</b>'
            + (it.img ? ' <span style="color:#999" title="图片消息: ' + (it.lib ? '已在库 → 借它的标签当文字评分' : '无文字, 不可评分(默认不拦)') + '">' + (it.lib ? '[库内]' : '[无文字]') + '</span>' : '')
            + (it.mention ? ' <span style="color:#1c7ed6" title="被@, 必回">[@]</span>' : '')
            + (it.conf !== undefined && it.conf < 0.5 ? ' <span style="color:#999" title="低置信: 最近邻居相似度只有 ' + it.conf + ', 地图上没这类样本 —— 仅作补样本提示, 不再影响拦截">[?]</span>' : '')
            + (it.agg ? ' <span style="color:#e8590c" title="聚合了 ' + it.agg + ' 条消息, 取其中最高分">[合' + it.agg + ']</span>' : '')
            + ' <span style="color:#555">' + esc(String(it.sender || '?')) + ':</span> '
            + esc(String(it.text || '').slice(0, 56))
            + '<div style="color:#bbb;font-size:11px;margin-left:14px">近邻: ' + esc((it.top || []).join(' · ')) + '</div>'
            + '</div>'
        })
        out += '</div>'
        out += '<div class="dk-msg" style="font-size:11px;color:#888">共 ' + (vs.total || 0) + ' 条 · 明细文件: {数据根}/.qqbot/value-scores.jsonl</div>'
        return out
      }
      // 局部刷新评分列表(不调 paintBody → 不闪、不打断滚动、不丢输入框焦点)
      // 好感度(观察期): 只读展示 —— 谁互动最多/被点名最多/最常接她的话
      function loadAffinity() {
        if (state.tab !== 'session') return
        var box = panel ? panel.querySelector('#dk-aff-box') : null
        fetch('/api/qqbot-settings/affinity' + (state.ns ? '?' + outNsQ() : ''))
          .then(function (r) { return r.json() })
          .then(function (d) {
            var items = (d && d.items) || []
            if (items.length === 0) { state.affHtml = '还没有数据 —— 群里聊几句就出来了'; }
            else {
              state.affHtml = items.map(function (x, i) {
                var age = x.lastAt ? Math.round((Date.now() - x.lastAt) / 60000) : 0
                return (i + 1) + '. ' + (x.name || x.key) + '  💗' + x.score + '  (消息' + x.msgs + '/点名' + x.mentions + '/接话' + x.replies + (age < 120 ? ' · ' + age + '分钟前' : '') + ')'
              }).join('\n')
            }
            if (box) box.textContent = state.affHtml
          })
          .catch(function () { if (box) box.textContent = '好感度读取失败' })
      }
      function refreshScoreList() {
        if (state.tab !== 'session') return
        fetch('/api/qqbot-settings/value-scores' + scoreQuery())
          .then(function (r) { return r.json() })
          .then(function (d) {
            var next = d && d.ok ? d : { items: [], total: 0 }
            // ⚠️ 2026-09-13 修(主人反馈"一直被重绘"): 原来每 10 秒**无条件**替换 innerHTML →
            //    内容没变也会闪一下。现在比较签名(最后3条+总数), 一样就完全不碰 DOM。
            var sig = (next.total || 0) + '|' + JSON.stringify((next.items || []).slice(-3))
            if (sig === state.vsSig) { state.valueScores = next; return }
            state.vsSig = sig
            state.valueScores = next
            var box = panel ? panel.querySelector('#dk-vs-box') : null
            if (box) box.innerHTML = scoreListHtml(state.valueScores)
          })
          .catch(function () { /* 静默: 拉取失败保持原样 */ })
      }
      // 当前会话命中的 QQ 目标(2026-09-13 主人要求: 评分/操作要跟随"当前会话", 与群管理页一致)
      function curHitGid() {
        var hit = state.detectedHit
        return (hit && hit.scope === 'group' && hit.peerId) ? hit.peerId : ''
      }
      function curHitLabel() {
        var hit = state.detectedHit
        if (!hit || !hit.peerId) return '（当前会话不是 QQ 会话）'
        return (hit.scope === 'group' ? '群「' + (hit.name || '…') + '」' : '私聊「' + (hit.name || '…') + '」')
      }
      function scoreQuery() {
        var q = []
        if (state.ns) q.push(outNsQ())
        var g = curHitGid()
        if (g) q.push('gid=' + encodeURIComponent(g))
        q.push('limit=20')
        return '?' + q.join('&')
      }
      // ✍️ 样例库编辑: 读现有内容(展开时才拉)
      function loadValueSamplesEditor() {
        fetch('/api/qqbot-settings/value-samples' + (state.ns ? '?' + outNsQ() : ''))
          .then(function (r) { return r.json() })
          .then(function (d) {
            var stat = panel ? panel.querySelector('#dk-vs-stat') : null
            var ta = panel ? panel.querySelector('#dk-vs-text') : null
            if (d && d.ok) {
              if (stat) stat.textContent = '共 ' + d.total + ' 条(她会接 ' + d.pos + ' / 不会理 ' + d.neg + ')' + (d.isDefault ? ' · 暂用内置默认, 保存后自建' : '')
              if (ta) ta.value = d.text || ''
            } else if (stat) stat.textContent = (d && d.error) || '读取失败'
          })
          .catch(function () { /* 静默 */ })
      }
      function saveValueSamplesEditor() {
        var ta = panel ? panel.querySelector('#dk-vs-text') : null
        var hint = panel ? panel.querySelector('#dk-vs-hint') : null
        if (!ta) return
        if (hint) hint.textContent = '保存中…'
        fetch('/api/qqbot-settings/value-samples', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ns: state.ns, text: ta.value }),
        }).then(function (r) { return r.json() }).then(function (d) {
          if (d && d.ok) {
            if (hint) hint.textContent = '已保存 ✓ ' + d.saved + ' 条(她会接 ' + d.pos + ' / 不会理 ' + d.neg + ') · 下一条群消息生效'
            loadValueSamplesEditor()
          } else if (hint) hint.textContent = '保存失败: ' + ((d && d.error) || '未知')
        }).catch(function (e) { if (hint) hint.textContent = '异常: ' + e.message })
      }
      function loadLocalModel() {
        if (state.tab !== 'session') return
        // ⚠️ 2026-09-13 修(主人反馈面板一直闪): 原来 paintBody 的绑定区里也调了 loadLocalModel(),
        //    而它完成后又调 paintBody() → 无限循环重绘。现在绑定区只做绑定, 这里再加一道防重入锁。
        if (state.lmBusy) return
        state.lmBusy = true
        var nsq = state.ns ? '?' + outNsQ() : ''
        state.valueScores = null
        fetch('/api/qqbot-settings/local-model/status' + nsq).then(function (r) { return r.json() }).then(function (d) {
          state.localModel = d && d.ok ? d : null
          paintBody()
        }).catch(function () { state.localModel = null; paintBody() })
        // ⚠️ 2026-09-13 加固(主人反馈"永远显示只记录"): **直读 settings 配置**拿真实 valueGate/enabled/门槛,
        //    不再依赖 status 接口有没有带这些字段(host 未重启时旧接口不返回 → 会一直显示默认"只记录")。
        fetch(READ + (state.ns ? '?' + outNsQ() : '')).then(function (r) { return r.json() }).then(function (d) {
          state.lmCfg = (d && d.value && d.value.localModel) || null
          paintBody()
        }).catch(function () { state.lmCfg = null; paintBody() })
        fetch('/api/qqbot-settings/value-scores' + scoreQuery())
          .then(function (r) { return r.json() })
          .then(function (d) { state.valueScores = d && d.ok ? d : { items: [], total: 0 }; paintBody() })
          .catch(function () { state.valueScores = { items: [], total: 0 }; paintBody() })
          .then(function () { loadAffinity() })
          .then(function () { state.lmBusy = false })
        // 每 10 秒局部刷新一次评分列表(只换 #dk-vs-box 内容, 不整块重绘 → 不闪)
        if (state.lmTimer) clearInterval(state.lmTimer)
        state.lmTimer = setInterval(refreshScoreList, 10000)
        if (state.vsOpen) loadValueSamplesEditor()   // 重绘后把编辑区内容补回来(展开状态已存 state)
      }
      // 保存(全量 patch 合并: settings update 是全量语义, 不能只发单字段)
      /** 当前会话的覆盖键: "group:<gid>" / "c2c:<openid>"; 未命中(非 QQ 会话) → '' */
      function curOvKey() {
        var hit = state.detectedHit
        return (hit && hit.peerId) ? (hit.scope + ':' + hit.peerId) : ''
      }
      function saveLocalModel() {
        var hint = panel ? panel.querySelector('#dk-lm-hint') : null
        var onEl = panel ? panel.querySelector('#dk-lm-on') : null
        var dirEl = panel ? panel.querySelector('#dk-lm-dir') : null
        var gateEl = panel ? panel.querySelector('input[name="dk-lm-gate"]:checked') : null
        var minEl = panel ? panel.querySelector('#dk-lm-min') : null
        var ovKey = curOvKey()
        // ⚠️ 2026-09-13 会话级(主人要求): 评分模式/门槛/启用 存进 **当前会话** 的覆盖项;
        //    模型目录是账号级(模型只有一份), 仍写账号默认。
        if (!ovKey) {
          if (hint) hint.textContent = '✗ 当前会话不是 QQ 会话 —— 单会话设置需先切到与 bot 的群/私聊(顶栏「当前会话」要命中)'
          return
        }
        var ovNext = {
          enabled: onEl ? !!onEl.checked : true,
          valueGate: gateEl ? gateEl.value : 'log',
          valueMinScore: minEl ? (parseFloat(minEl.value) || 0.5) : 0.5,
        }
        if (hint) hint.textContent = '保存中…'
        fetch(READ + (state.ns ? '?' + outNsQ() : '')).then(function (r) { return r.json() }).then(function (d) {
          var cur = (d && d.value) || {}
          var lm = Object.assign({}, cur.localModel || {})
          if (dirEl) lm.modelDir = String(dirEl.value || '').trim()      // 账号级
          lm.overrides = Object.assign({}, (lm.overrides || {}))
          lm.overrides[ovKey] = ovNext                                    // 会话级
          var patch = Object.assign({}, cur, { localModel: lm })
          return fetch(UPDATE, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ns: state.ns || undefined, patch: patch, expectedRevision: d && d.revision }),
          }).then(function (r2) { return r2.json() })
        }).then(function (res) {
          if (res && !res.error) {
            if (hint) hint.textContent = '已保存 ✓(仅对本会话生效, live)'
            // 立刻把新值写进本地缓存并渲染(不等接口回读)
            var lm2 = Object.assign({}, state.lmCfg || {})
            lm2.overrides = Object.assign({}, (lm2.overrides || {}))
            lm2.overrides[ovKey] = ovNext
            if (dirEl) lm2.modelDir = String(dirEl.value || '').trim()
            state.lmCfg = lm2
            paintBody()
            setTimeout(function () { loadLocalModel() }, 2000)
          } else if (hint) hint.textContent = '保存失败: ' + ((res && res.error) || '未知响应')
        }).catch(function (e) { if (hint) hint.textContent = '保存异常: ' + e.message })
      }
      function bindLocalModel() {
        if (state.tab !== 'session' || !panel) return
        var hint = function (t) { var el = panel.querySelector('#dk-lm-hint'); if (el) el.textContent = t }
        var onEl = panel.querySelector('#dk-lm-on')
        if (onEl) onEl.onchange = function () { saveLocalModel() }
        // 评分模式 + 门槛: 改动即自动保存
        // ⚠️ 2026-09-13 修(主人反馈"低分不唤醒怎么保存不了"): 原来只有"启用"开关绑了 onchange,
        //    点三个评分模式单选按钮不会保存 → 看着像"选不了"; 现在 radio 与门槛都自动保存。
        panel.querySelectorAll('input[name="dk-lm-gate"]').forEach(function (r) {
          r.onchange = function () { saveLocalModel() }
        })
        var minInput = panel.querySelector('#dk-lm-min')
        if (minInput) minInput.onchange = function () { saveLocalModel() }
        // ↩ 恢复继承: 删掉本会话的覆盖项(2026-09-13 会话级)
        var resetBtn = panel.querySelector('#dk-lm-reset')
        if (resetBtn) resetBtn.onclick = function () {
          var h = panel.querySelector('#dk-lm-hint')
          var ovKey = curOvKey()
          if (!ovKey) return
          if (h) h.textContent = '恢复继承中…'
          fetch(READ + (state.ns ? '?' + outNsQ() : '')).then(function (r) { return r.json() }).then(function (d) {
            var cur = (d && d.value) || {}
            var lm = Object.assign({}, cur.localModel || {})
            var ovs = Object.assign({}, (lm.overrides || {}))
            delete ovs[ovKey]
            lm.overrides = ovs
            var patch = Object.assign({}, cur, { localModel: lm })
            return fetch(UPDATE, {
              method: 'POST', headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ ns: state.ns || undefined, patch: patch, expectedRevision: d && d.revision }),
            }).then(function (r2) { return r2.json() })
          }).then(function (res) {
            if (res && !res.error) {
              if (h) h.textContent = '已恢复继承账号默认 ✓'
              if (state.lmCfg && state.lmCfg.overrides) {
                var o2 = Object.assign({}, state.lmCfg.overrides)
                delete o2[ovKey]
                state.lmCfg = Object.assign({}, state.lmCfg, { overrides: o2 })
              }
              paintBody()
              setTimeout(function () { loadLocalModel() }, 2000)
            } else if (h) h.textContent = '恢复失败: ' + ((res && res.error) || '未知')
          }).catch(function (e) { if (h) h.textContent = '异常: ' + e.message })
        }
        var saveBtn = panel.querySelector('#dk-lm-save')
        if (saveBtn) saveBtn.onclick = function () { saveLocalModel() }
        var chkBtn = panel.querySelector('#dk-lm-check')
        if (chkBtn) chkBtn.onclick = function () { state.localModel = null; paintBody(); loadLocalModel() }
        var vsBtn = panel.querySelector('#dk-vs-reload')
        if (vsBtn) vsBtn.onclick = function () { refreshScoreList() }
        // ✍️ 样例库编辑区
        var vsToggle = panel.querySelector('#dk-vs-edit-toggle')
        if (vsToggle) vsToggle.onclick = function () {
          var box = panel.querySelector('#dk-vs-editor')
          if (!box) return
          state.vsOpen = !state.vsOpen            // 存进 state: 重绘后不缩回
          box.style.display = state.vsOpen ? 'block' : 'none'
          vsToggle.textContent = state.vsOpen ? '收起' : '展开编辑'
          if (state.vsOpen) loadValueSamplesEditor()
        }
        var vsSaveBtn = panel.querySelector('#dk-vs-save')
        if (vsSaveBtn) vsSaveBtn.onclick = function () { saveValueSamplesEditor() }
        // 🤖 让ai写(2026-09-13 主人要的): 模拟一条用户消息唤醒她 → 她自己读聊天记录写样例
        // 目标 = 面板「当前会话」命中的群/私聊(与群管理页一致); 未命中 QQ 会话则明确提示
        var aiWriteBtn = panel.querySelector('#dk-vs-aiwrite')
        if (aiWriteBtn) aiWriteBtn.onclick = function () {
          var h = panel.querySelector('#dk-vs-hint')
          var hit = state.detectedHit
          if (!hit || !hit.peerId) {
            if (h) h.textContent = '✗ 当前会话不是 QQ 会话(顶栏「当前会话」未命中群/私聊) —— 请先切到与 bot 的群/私聊会话'
            return
          }
          if (h) h.textContent = '发给 AI 中…(' + (hit.scope === 'group' ? '群' : '私聊') + '「' + (hit.name || '') + '」)'
          fetch('/api/qqbot-settings/value-samples/let-ai-write', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ns: hit.ns || state.ns, scope: hit.scope, peerId: hit.peerId }),
          }).then(function (r) { return r.json() }).then(function (d) {
            if (h) h.textContent = d && d.ok ? ('✓ ' + d.msg) : ('失败: ' + ((d && d.error) || (d && d.msg) || '未知'))
          }).catch(function (e) { if (h) h.textContent = '异常: ' + e.message })
        }
        // ⚙ 单会话设置: 次级标签切换(🧠 智能回复 / 📄 空白样板)
        panel.querySelectorAll('[data-sttab]').forEach(function (sb) {
          sb.onclick = function () {
            var v = sb.getAttribute('data-sttab')
            state.stTab = v
            paintBody()
            if (v === 'lm') loadLocalModel()
          }
        })
        var dlBtn = panel.querySelector('#dk-lm-dl')
        if (dlBtn) dlBtn.onclick = function () {
          dlBtn.disabled = true
          hint('下载中…(约 23MB, 1~2 分钟, 面板别关)')
          fetch('/api/qqbot-settings/local-model/download', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ns: state.ns }),
          }).then(function (r) { return r.json() }).then(function (d) {
            if (d && d.ok) { hint('下载完成 ✓'); state.localModel = null; paintBody(); loadLocalModel() }
            else { hint('下载失败: ' + ((d && d.error) || JSON.stringify(d))); dlBtn.disabled = false }
          }).catch(function (e) { hint('下载异常: ' + e.message); dlBtn.disabled = false })
        }
      }
      // ⚙️ 出站方式: 读当前账号(ns)配置
      function loadOutMode() {
        if (state.tab !== 'out') return
        fetch(READ + (state.ns ? '?' + outNsQ() : '')).then(function (r) { return r.json() }).then(function (d) {
          if (d && d.value) { state.outMode = (d.value.outboundMode === 'detail' || d.value.outboundMode === 'passive' || d.value.outboundMode === 'silent' || d.value.outboundMode === 'nothink' ? d.value.outboundMode : 'adaptive'); state.outRev = d.revision; paintBody() }
        }).catch(function () {})
      }
      // ⚙️ 出站方式: 保存(全量 patch 只带 outboundMode; settings.update 部分合并)
      function saveOutMode(m, attempt) {
        var hint = panel ? panel.querySelector('#dk-out-hint') : null
        var trySave = function (curVal, curRev) {
          if (hint) hint.textContent = '保存中…'
          // 合并当前全量 value + 新 outboundMode(settings update 是全量语义, 不能只发单字段)
          var patch = Object.assign({}, curVal || {}, { outboundMode: m })
          return fetch(UPDATE, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ns: state.ns || undefined, patch: patch, expectedRevision: curRev }),
          }).then(function (r) { return r.json().catch(function () { return null }) }).then(function (d) {
            if (d && d.value) { state.outMode = (d.value.outboundMode === 'detail' || d.value.outboundMode === 'passive' || d.value.outboundMode === 'silent' || d.value.outboundMode === 'nothink' ? d.value.outboundMode : 'adaptive'); state.outRev = d.revision; var h2 = panel ? panel.querySelector('#dk-out-hint') : null; if (h2) h2.textContent = '已保存 ✓ live 热更新已生效(不用重启)' }
            else {
              var conflicted = !!(d && d.error && String(d.error).indexOf('changed since it was read') >= 0)
              if (conflicted && !attempt) { refreshOutModeAndRetry(m) }
              else { var h3 = panel ? panel.querySelector('#dk-out-hint') : null; if (h3) h3.textContent = '保存失败: ' + ((d && d.error) || '未知错误') }
            }
          }).catch(function () { var h4 = panel ? panel.querySelector('#dk-out-hint') : null; if (h4) h4.textContent = '保存异常' })
        }
        var refreshOutModeAndRetry = function (mm) {
          fetch(READ + (state.ns ? '?' + outNsQ() : '')).then(function (r) { return r.json() }).then(function (dd) {
            if (dd && dd.value) { trySave(dd.value, dd.revision) }
            else { var h5 = panel ? panel.querySelector('#dk-out-hint') : null; if (h5) h5.textContent = '保存失败: 无法重新读取最新设置'; }
          }).catch(function () { var h6 = panel ? panel.querySelector('#dk-out-hint') : null; if (h6) h6.textContent = '保存失败: 读取异常' })
        }
        // 首次: 先读最新 revision 再保存(避免 stale revision)
        fetch(READ + (state.ns ? '?' + outNsQ() : '')).then(function (r) { return r.json() }).then(function (d0) {
          if (d0 && d0.value) { trySave(d0.value, d0.revision) }
          else { var h7 = panel ? panel.querySelector('#dk-out-hint') : null; if (h7) h7.textContent = '保存失败: 无法读取当前设置' }
        }).catch(function () { var h8 = panel ? panel.querySelector('#dk-out-hint') : null; if (h8) h8.textContent = '保存失败: 读取异常' })
      }
      function refreshAll() {
        loadGroups(); loadC2cs()
      }
      function loadGroups() {
        state.groups = []
        var q = state.ns ? 'ns=' + encodeURIComponent(state.ns) : ''
        api('group/accounts', q).then(function (d) {
          state.groups = (d && Array.isArray(d.groups) ? d.groups : []).map(function (g) { return { gid: g.gid, name: g.name || '', from: g.from || '', lastAt: (g && g.lastAt) || 0 } })
          // 期望目标(wantPeer)命中则选中它, 否则回落第一个
          var wantGid = (state.wantPeer && state.wantPeer.scope === 'group') ? state.wantPeer.peerId : ''
          if (state.groups.some(function (g) { return g.gid === state.gid })) { /* 保持现选 */ }
          else if (wantGid && state.groups.some(function (g) { return g.gid === wantGid })) state.gid = wantGid
          else if (state.groups.length) state.gid = state.groups[0].gid
          else state.gid = ''
          paintBody()
        })
      }
      function loadC2cs() {
        var dd = curDataDir()
        state.c2cs = []
        if (!dd) { paintBody(); return }
        // 目标候选 = 真·私聊台账(known-chats scope=c2c, 即"与该机器人私聊过/开过会话"的人)。
        // ⚠️ 不能混入 group-members(群成员≠私聊对象: 群 member_openid 与 c2c openid 不同域,
        //    且 dsh 里一个 QQ 会话只绑定一个对象, 仅群里见过的人没有可私聊会话 → 发不出去)。
        var qNs = state.ns ? ('?ns=' + encodeURIComponent(state.ns)) : ''
        var qDD = dd ? ('?dataDir=' + encodeURIComponent(dd)) : ''
        Promise.all([
          api('known-chats', qDD.replace('?', '')),
          api('group/members_local', qNs.replace('?', '')),
        ]).then(function (rs) {
          var known = ((rs[0] && rs[0].chats) || [])
          // 群成员表仅用于给同 id 的私聊对象补昵称(不同域通常不命中, 无副作用)
          var nameByMid = {}
          ;((rs[1] && rs[1].members) || []).forEach(function (m) {
            if (m.mid && m.name) {
              var old = nameByMid[m.mid]
              if (!old || m.lastSeen > old.ts) nameByMid[m.mid] = { name: m.name, ts: m.lastSeen || 0 }
            }
          })
          var c2c = []
          var seen = {}
          known.forEach(function (c) {
            if (c.scope !== 'c2c' || !c.id || seen[c.id]) return
            seen[c.id] = 1
            var nm = c.name || (nameByMid[c.id] && nameByMid[c.id].name) || ''
            c2c.push({ id: c.id, name: nm, lastSeen: c.lastSeen || 0, count: c.count || 0 })
          })
          c2c.sort(function (a, b) { return (b.lastSeen || 0) - (a.lastSeen || 0) })
          state.c2cs = c2c
          // 期望目标(wantPeer)是私聊 → 自动选中该对象
          if (state.wantPeer && state.wantPeer.scope === 'c2c') {
            var hit = null
            state.c2cs.forEach(function (c) { if (c.id === state.wantPeer.peerId) hit = c })
            if (hit) { state.sendTo = hit.id; state.sendName = hit.name || '' }
            else if (state.wantPeer.peerId) { state.sendTo = state.wantPeer.peerId; state.sendName = state.wantPeer.peerId }
          } else if (!state.sendTo && state.c2cs.length && state.sendScope === 'c2c') {
            state.sendTo = state.c2cs[0].id; state.sendName = state.c2cs[0].name || ''
          }
          paintBody()
        })
      }
      function fmtDeadline(ts) {
        var left = Math.max(0, Math.ceil((ts - Date.now()) / 1000))
        return left > 60 ? Math.ceil(left / 60) + ' 分钟' : left + ' 秒'
      }
      function groupSelName() {
        var g = null; state.groups.forEach(function (x) { if (x.gid === state.gid) g = x })
        return g ? g.name || state.gid.slice(0, 10) : '(未选群)'
      }
      function c2cSelName() {
        if (state.sendName) return state.sendName
        var c = null; state.c2cs.forEach(function (x) { if (x.id === state.sendTo) c = x })
        return c ? (c.name || c.id.slice(0, 10)) : '(未选)'
      }
      // ── 📇 群组管理 M1: 会话台账勾选(群 = 群会话; 个人 = 真私聊过的人(c2c 会话), 复用 state.groups+state.c2cs) ──
      function rosterRows() {
        var rows = []
        state.groups.forEach(function (g) { rows.push({ key: 'group:' + g.gid, scope: 'group', id: g.gid, name: g.name || '', lastSeen: (g && g.lastAt) || 0, count: 0 }) })
        state.c2cs.forEach(function (c) { rows.push({ key: 'c2c:' + c.id, scope: 'c2c', id: c.id, name: c.name || '', lastSeen: (c && c.lastSeen) || 0, count: (c && c.count) || 0 }) })
        var sel = state.rosterScope
        var q = String(state.rosterQ || '').trim().toLowerCase()
        return rows.filter(function (r) {
          if (sel !== 'all' && r.scope !== sel) return false
          if (!q) return true
          return (r.name || '').toLowerCase().indexOf(q) >= 0 || r.id.toLowerCase().indexOf(q) >= 0
        }).sort(function (a, b) { return (b.lastSeen || 0) - (a.lastSeen || 0) })
      }
      function fmtRosterTime(ts) {
        if (!ts) return ''
        try { var d = new Date(ts); var mm = d.getMonth() + 1; var hh = d.getHours() < 10 ? '0' + d.getHours() : d.getHours(); var mi = d.getMinutes() < 10 ? '0' + d.getMinutes() : d.getMinutes(); return mm + '/' + d.getDate() + ' ' + hh + ':' + mi } catch (e) { return '' }
      }
      function rosterSelN() { var n = 0; for (var k in state.rosterSel) { if (state.rosterSel[k]) n++ } return n }
      function renderRosterList() {
        if (!panel || !open) return
        var box = panel.querySelector('#dk-roster-list')
        if (!box) return
        var rows = rosterRows()
        // 🗂 分组筛选(仅"选目标"页生效): 选中某分组 → 只列该组成员(2026-09-10)
        if (state.tab === 'send' && state.tgCur) {
          var curG = (state.tgGroups || []).filter(function (g2) { return g2 && g2.id === state.tgCur })[0]
          var mem = (curG && curG.members) || []
          rows = rows.filter(function (r) { return mem.indexOf(r.key) >= 0 })
        }
        var stat = panel.querySelector('#dk-roster-stat')
        if (stat) stat.textContent = '共 ' + rows.length + ' 条 · 已选 ' + rosterSelN()
        if (!rows.length) {
          box.innerHTML = '<div class="dk-empty">' + ((state.rosterScope === 'all' && !String(state.rosterQ || '').trim()) ? '没有会话记录: 机器人被拉进群/有人私聊过后会自动累积(仅这些对象可被直接投递)。' : '没有匹配项。') + '</div>'
          return
        }
        var html = ''
        rows.forEach(function (r) {
          var on = !!state.rosterSel[r.key]
          var tail = r.id.length > 10 ? '…' + r.id.slice(-6) : r.id
          var nm = r.name || '(未知名)'
          html += '<label class="dk-item" style="cursor:pointer;background:' + (on ? '#f1ecff' : 'transparent') + '">'
            + '<input type="checkbox" data-rkey="' + r.key + '"' + (on ? ' checked' : '') + ' style="accent-color:#7c6cf0;flex:none">'
            + '<span style="flex:1;min-width:0;display:flex;gap:6px;align-items:baseline;flex-wrap:wrap"><b>' + esc(nm) + '</b>'
            + '<span style="color:#aaa;font-size:11px">' + (r.scope === 'group' ? '👥 群' : '👤 私聊') + ' · ' + esc(tail) + '</span></span>'
            + '<span style="color:#9aa0a8;font-size:11px;flex:none">' + fmtRosterTime(r.lastSeen) + '</span></label>'
        })
        box.innerHTML = html
      }
      function rosterToggle(key) {
        if (!key) return
        if (state.rosterSel[key]) delete state.rosterSel[key]
        else state.rosterSel[key] = true
        try { localStorage.setItem('qqs-roster-sel', JSON.stringify(state.rosterSel)) } catch (e) {}
        renderRosterList()
      }
      function bindRosterEvents() {
        if (!panel) return
        var qEl = panel.querySelector('#dk-roster-q')
        if (qEl) qEl.oninput = function (e) { state.rosterQ = e.target.value; renderRosterList() }
        var scopes = panel.querySelectorAll('input[name="dk-rscope"]')
        scopes.forEach(function (r) { r.onchange = function () { state.rosterScope = r.value; renderRosterList() } })
        var ref = panel.querySelector('#dk-roster-refresh')
        if (ref) ref.onclick = function () {
          var q2 = panel.querySelector('#dk-roster-q'); if (q2) q2.value = ''
          state.rosterQ = ''; refreshAll(); loadHubState()
        }
        var allB = panel.querySelector('#dk-roster-all')
        if (allB) allB.onclick = function () {
          rosterRows().forEach(function (r) { state.rosterSel[r.key] = true })
          try { localStorage.setItem('qqs-roster-sel', JSON.stringify(state.rosterSel)) } catch (e) {}
          renderRosterList()
        }
        var clr = panel.querySelector('#dk-roster-clear')
        if (clr) clr.onclick = function () {
          state.rosterSel = {}
          try { localStorage.setItem('qqs-roster-sel', JSON.stringify(state.rosterSel)) } catch (e) {}
          renderRosterList()
        }
        var box = panel.querySelector('#dk-roster-list')
        if (box) box.onclick = function (e) {
          var cb = e.target
          while (cb && cb !== box && !(cb.tagName === 'INPUT' && cb.type === 'checkbox')) cb = cb.parentNode
          if (!cb || cb === box) return
          rosterToggle(cb.getAttribute('data-rkey'))
        }
        // 🗂 分组管理(仿 QQ 分组, 2026-09-10 主人要求; 选择器页专属元素, 不在时自动跳过)
        var tgCurGroup = function () { return (state.tgGroups || []).filter(function (g2) { return g2 && g2.id === state.tgCur })[0] }
        var tgPersistSel = function () { try { localStorage.setItem('qqs-roster-sel', JSON.stringify(state.rosterSel)) } catch (e) {} }
        var tgSel = panel.querySelector('#dk-tg-sel')
        if (tgSel) tgSel.onchange = function () { state.tgCur = tgSel.value; paintBody(); bindBodyEvents() }
        var tgNew = panel.querySelector('#dk-tg-new')
        if (tgNew) tgNew.onclick = function () {
          var nm = window.prompt('新建分组名称:', '新分组')
          if (!nm) return
          var id = 'tg' + Date.now().toString(36).slice(-5)
          state.tgGroups.push({ id: id, name: String(nm).slice(0, 20), members: [] })
          state.tgCur = id
          saveTgGroups(); paintBody(); bindBodyEvents()
        }
        var tgRen = panel.querySelector('#dk-tg-rename')
        if (tgRen) tgRen.onclick = function () {
          var cur = tgCurGroup(); if (!cur) return
          var nm = window.prompt('改名:', cur.name || '')
          if (!nm) return
          cur.name = String(nm).slice(0, 20)
          saveTgGroups(); paintBody(); bindBodyEvents()
        }
        var tgDel = panel.querySelector('#dk-tg-del')
        if (tgDel) tgDel.onclick = function () {
          var cur = tgCurGroup(); if (!cur) return
          if (!window.confirm('删除分组「' + (cur.name || '') + '」? (只删分组, 不影响目标本身)')) return
          state.tgGroups = (state.tgGroups || []).filter(function (g2) { return g2.id !== state.tgCur })
          state.tgCur = ''
          saveTgGroups(); paintBody(); bindBodyEvents()
        }
        var tgAdd = panel.querySelector('#dk-tg-add')
        if (tgAdd) tgAdd.onclick = function () {
          var cur = tgCurGroup(); if (!cur) return
          var sel = Object.keys(state.rosterSel || {}).filter(function (k) { return state.rosterSel[k] })
          if (!sel.length) { window.alert('先在下面勾选目标, 再点加入本组'); return }
          var mem = cur.members || (cur.members = [])
          var n = 0
          sel.forEach(function (k) { if (mem.indexOf(k) < 0) { mem.push(k); n++ } })
          saveTgGroups(); paintBody(); bindBodyEvents()
          window.alert('已加入 ' + n + ' 个(本组共 ' + mem.length + ' 个)')
        }
        var tgRm = panel.querySelector('#dk-tg-remove')
        if (tgRm) tgRm.onclick = function () {
          var cur = tgCurGroup(); if (!cur) return
          var sel = Object.keys(state.rosterSel || {}).filter(function (k) { return state.rosterSel[k] })
          var before = (cur.members || []).length
          cur.members = (cur.members || []).filter(function (k) { return sel.indexOf(k) < 0 })
          saveTgGroups(); paintBody(); bindBodyEvents()
          window.alert('已移出 ' + (before - cur.members.length) + ' 个')
        }
        var tgPickAll = panel.querySelector('#dk-tg-pickall')
        if (tgPickAll) tgPickAll.onclick = function () {
          var cur = tgCurGroup(); if (!cur) return
          ;(cur.members || []).forEach(function (k) { state.rosterSel[k] = true })
          tgPersistSel(); paintBody(); bindBodyEvents()
        }
        var tgGoto = panel.querySelector('#dk-pick-goto')
        if (tgGoto) tgGoto.onclick = function () { state.tab = 'broadcast'; paintBody(); bindBodyEvents() }
        // 🎯 群组管理器: 设本会话/取消(走 settings groupAdmin.hubSessionId, live 热更)
        var hubSet = panel.querySelector('#dk-hub-set')
        if (hubSet) hubSet.onclick = function () {
          var sid = readCurrentSessionId()
          if (!sid) { hubHint('未识别到当前 web 会话(稍后再试)'); return }
          saveHub(sid)
        }
        var hubClr = panel.querySelector('#dk-hub-clear')
        if (hubClr) hubClr.onclick = function () { saveHub('') }
        // ⚙ 群组设置(轮询等): 读控件 → 保存到 settings groupAdmin(live 热更)
        var gaSave = panel.querySelector('#dk-ga-save')
        if (gaSave) gaSave.onclick = function () {
          var read = function (id) { var el = panel.querySelector(id); return el ? el.checked : false }
          var num = function (id, dft) {
            var el = panel.querySelector(id)
            var v = parseInt(el ? el.value : '', 10)
            return isNaN(v) || v < 1 ? dft : v
          }
          state.gaEnabled = read('#dk-ga-enabled')
          state.gaPoll = read('#dk-ga-poll')
          state.gaPollWake = read('#dk-ga-pollwake')
          state.gaHubNotify = read('#dk-ga-hubnotify')
          state.gaNotifyGroup = read('#dk-ga-notifygroup')
          state.gaWakeGroup = read('#dk-ga-wakegroup')
          state.gaInterval = num('#dk-ga-interval', 5)
          state.gaMinCount = num('#dk-ga-mincount', 1)
          saveGroupAdmin()
        }
        // M3 群发(自动审批策略已按主人要求移除 2026-09-10)
        bindBroadcastEvents()
      }
      function hubStatusText() {
        if (state.hubSid) return '已设: 会话 ' + state.hubSid.slice(0, 8) + '… ← 各群群事件(入群申请/新成员/被拉群)汇总注入这里'
        return '未设置: 群事件只在原群内提醒'
      }
      function hubHint(t) {
        state.hubMsg = t || ''
        var el = panel && panel.querySelector('#dk-hub-hint')
        if (el) el.textContent = state.hubMsg
      }
      function loadHubState() {
        fetch(READ + (state.ns ? '?' + outNsQ() : '')).then(function (r) { return r.json() }).then(function (d) {
          if (!d || !d.value) return
          var ga = d.value.groupAdmin || {}
          state.hubSid = ga.hubSessionId || ''
          state.hubRev = d.revision
          var st = panel && panel.querySelector('#dk-hub-status')
          if (st) st.textContent = hubStatusText()
          var clr = panel && panel.querySelector('#dk-hub-clear')
          if (clr) clr.disabled = !state.hubSid
          // ⚙ 群组设置: 载入轮询/开关当前值
          var poll = ga.pollJoinRequests || {}
          state.gaEnabled = ga.enabled === true
          state.gaPoll = poll.enabled === true
          state.gaPollWake = poll.wakeLlm !== false
          state.gaHubNotify = poll.hubNotify !== false
          state.gaNotifyGroup = poll.notifyGroup !== false
          state.gaWakeGroup = poll.wakeGroup === true
          state.gaInterval = poll.intervalMin || 5
          state.gaMinCount = poll.minCount || 1
          var e1 = panel && panel.querySelector('#dk-ga-enabled'); if (e1) e1.checked = state.gaEnabled
          var e2 = panel && panel.querySelector('#dk-ga-poll'); if (e2) e2.checked = state.gaPoll
          var e3 = panel && panel.querySelector('#dk-ga-pollwake'); if (e3) e3.checked = state.gaPollWake
          var e4 = panel && panel.querySelector('#dk-ga-hubnotify'); if (e4) e4.checked = state.gaHubNotify
          var e4b = panel && panel.querySelector('#dk-ga-notifygroup'); if (e4b) e4b.checked = state.gaNotifyGroup
          var e4c = panel && panel.querySelector('#dk-ga-wakegroup'); if (e4c) e4c.checked = state.gaWakeGroup
          var e5 = panel && panel.querySelector('#dk-ga-interval'); if (e5) e5.value = state.gaInterval
          var e6 = panel && panel.querySelector('#dk-ga-mincount'); if (e6) e6.value = state.gaMinCount
        }).catch(function () {})
      }
      function gaHint(t) {
        state.gaMsg = t || ''
        var el = panel && panel.querySelector('#dk-ga-hint')
        if (el) el.textContent = state.gaMsg
      }
      function saveGroupAdmin() {
        state.gaBusy = 'ga'; gaHint('保存中…')
        var doSave = function () {
          var trySave = function (cur, rev) {
            var patch = Object.assign({}, cur || {})
            var ga = Object.assign({}, (cur && cur.groupAdmin) || {}, {
              enabled: state.gaEnabled,
              pollJoinRequests: {
                enabled: state.gaPoll,
                intervalMin: state.gaInterval,
                minCount: state.gaMinCount,
                wakeLlm: state.gaPollWake,
                hubNotify: state.gaHubNotify,
                notifyGroup: state.gaNotifyGroup,
                wakeGroup: state.gaWakeGroup,
              },
            })
            patch.groupAdmin = ga
            return fetch(UPDATE, {
              method: 'POST', headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ ns: state.ns || undefined, patch: patch, expectedRevision: rev }),
            }).then(function (r) { return r.json().catch(function () { return null }) }).then(function (d2) {
              state.gaBusy = ''
              if (d2 && d2.value) {
                state.hubRev = d2.revision
                gaHint('✓ 群组设置已保存(live 生效, 轮询无需重启)')
              } else {
                gaHint('保存失败: ' + ((d2 && d2.error) || '未知错误') + (d2 && String(d2.error || '').indexOf('changed since') >= 0 ? '(冲突, 请重试)' : ''))
              }
            }).catch(function () { state.gaBusy = ''; gaHint('保存异常') })
          }
          fetch(READ + (state.ns ? '?' + outNsQ() : '')).then(function (r) { return r.json() }).then(function (d) {
            if (d && d.value) trySave(d.value, d.revision)
            else { state.gaBusy = ''; gaHint('保存失败: 无法读取当前设置') }
          }).catch(function () { state.gaBusy = ''; gaHint('保存异常: 读取失败') })
        }
        doSave()
      }
      function saveHub(sid) {
        state.hubBusy = 'hub'; hubHint('保存中…')
        var doSave = function () {
          var trySave = function (cur, rev) {
            var patch = Object.assign({}, cur || {})
            var ga = Object.assign({}, (cur && cur.groupAdmin) || {}, { hubSessionId: sid || '' })
            patch.groupAdmin = ga
            return fetch(UPDATE, {
              method: 'POST', headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ ns: state.ns || undefined, patch: patch, expectedRevision: rev }),
            }).then(function (r) { return r.json().catch(function () { return null }) }).then(function (d2) {
              state.hubBusy = ''
              if (d2 && d2.value) {
                var ga2 = d2.value.groupAdmin || {}
                state.hubSid = ga2.hubSessionId || ''
                state.hubRev = d2.revision
                hubHint(sid ? '✓ 已设为本会话为群组管理器(live 生效): 各群群事件将注入此会话' : '✓ 已取消群组管理器')
                var st = panel && panel.querySelector('#dk-hub-status')
                if (st) st.textContent = hubStatusText()
                var clr = panel && panel.querySelector('#dk-hub-clear')
                if (clr) clr.disabled = !state.hubSid
              } else {
                hubHint('保存失败: ' + ((d2 && d2.error) || '未知错误') + (d2 && String(d2.error || '').indexOf('changed since') >= 0 ? '(冲突, 请重试)' : ''))
              }
            }).catch(function () { state.hubBusy = ''; hubHint('保存异常') })
          }
          // 先读最新 revision 再存(避免陈旧冲突)
          fetch(READ + (state.ns ? '?' + outNsQ() : '')).then(function (r) { return r.json() }).then(function (d) {
            if (d && d.value) trySave(d.value, d.revision)
            else { state.hubBusy = ''; hubHint('保存失败: 无法读取当前设置') }
          }).catch(function () { state.hubBusy = ''; hubHint('保存异常: 读取失败') })
        }
        // 预校验(防呆): 群事件按 hubSessionId 反查本 bot 的 QQ 会话——纯 web(未绑群/私聊)的会话注不进去
        if (!sid) { doSave(); return }
        api('session-lookup', 'sessionId=' + encodeURIComponent(sid)).then(function (d) {
          var hits = (d && d.ok && Array.isArray(d.hits)) ? d.hits : []
          if (!hits.length) {
            state.hubBusy = ''
            hubHint('⚠️ 当前会话未绑定任何 QQ 群/私聊: 群事件注入不进去。请先切到与 bot 的某个群/私聊会话(顶栏「当前会话」会显示命中)再点设置')
            return
          }
          doSave()
        }).catch(function () { doSave() })
      }
      // ── M3 群发(勾选集合 → 草稿 → 二次确认 → 任务列表) ──
      function rosterSelectedTargets() {
        var out = []
        rosterRows().forEach(function (r) {
          if (state.rosterSel[r.key]) out.push({ scope: r.scope, peerId: r.id, name: r.name || '' })
        })
        return out
      }
      function openBroadcastDraft(text) {
        var tg = rosterSelectedTargets()
        if (!tg.length) { state.msg = '请先勾选至少一个目标'; paintBody(); return }
        state.bcDraft = { text: text || '', targets: tg }
        paintBody()
        var ta = panel && panel.querySelector('#dk-bc-text')
        if (ta) ta.focus()
      }
      /**
       * 撤回"勾选目标"最近一条广播消息(2026-09-12 主人要求): **不必去任务列表翻 task_id** ——
       * 服务端自己找该目标最新的、已成功且有 message_id 的广播记录(2 分钟窗口内)。
       * 主人原话: "直接在勾选里面加撤回按钮, 无条件发送撤回"。
       */
      function recallSelectedLast() {
        var tg = rosterSelectedTargets()
        if (!tg.length) { rosterHint('先勾选要撤回的目标'); return }
        if (!window.confirm('撤回这些目标**最近一条广播消息**?\n\n' + tg.slice(0, 8).map(function (t) { return '· ' + (t.name || t.peerId) }).join('\n') + (tg.length > 8 ? '\n…' : '') + '\n\n(发出超过 2 分钟的会失败)')) return
        rosterHint('撤回中…')
        apiPost('group/recall-last', { ns: state.ns || undefined, targets: tg.map(function (t) { return { scope: t.scope, peerId: t.peerId } }) }).then(function (d) {
          if (!d || !d.ok) { rosterHint('❌ ' + ((d && d.error) || '撤回失败')); return }
          var rs = d.results || []
          var okN = rs.filter(function (r) { return r.ok }).length
          var fails = rs.filter(function (r) { return !r.ok })
          rosterHint('✅ 已撤回 ' + okN + '/' + rs.length + ' 个' + (fails.length ? '；失败 ' + fails.length + ' 个: ' + fails.slice(0, 2).map(function (r) { return (r.err || '未知') }).join(' / ') : ''))
        }).catch(function () { rosterHint('❌ 撤回异常') })
      }
      /** 选目标页的提示行(与 bcHint 同款, 元素 id 不同) */
      function rosterHint(t) {
        state.msg = t || ''
        var el = panel && panel.querySelector('#dk-roster-hint')
        if (el) el.textContent = t || ''
      }
      function bcHint(t) {
        state.msg = t || ''
        var el = panel && panel.querySelector('.dk-msg#dk-bc-hint')
        if (el) el.textContent = t || ''
      }
      /**
       * 拉取群发任务列表。
       * ⚠️ 2026-09-10 修复死循环: 本函数原本无条件 paintBody(), 而 paintBody() 内又会调用本函数
       *    (roster / broadcast 两个 tab) → 请求返回即重绘、重绘又请求 → 无限重建 DOM,
       *    表现为 dock 卡死、按钮刚绑定就被替换掉点不动。
       * 现: ①防重入(bcTaskLoading); ②silent=true 时只更新 state 不重绘(paintBody 内一律用 silent)。
       */
      var bcTaskLoading = false
      function loadBroadcastTasks(advance, silent) {
        // advance=true 是"推进任务"(会真的发消息), 必须执行, 不被防重入挡
        // (2026-09-10 修复: 原实现一律挡, paintBody 的静默请求在飞时用户点"确认群发"会被吞 → 任务一直 queued 发不出去)
        if (bcTaskLoading && !advance) return
        bcTaskLoading = true
        api('group/broadcast/list' + (advance ? '' : '?noadvance=1')).then(function (d) {
          if (d && d.ok && Array.isArray(d.tasks)) {
            state.bcTasks = d.tasks
            if (silent !== true) paintBody()
          }
        }).catch(function () {}).then(function () { bcTaskLoading = false })
      }
      // 广播子页: 有活跃任务时自动推进(每 3s 一次, 直到无 queued/sending) —— 2026-09-10
      // 任务推进靠 list 请求驱动(host 侧串行 advanceTask 天然限频), 所以必须有节奏地拉取
      var bcAdvTimer = null
      function startBroadcastAdvance() {
        if (bcAdvTimer) return
        bcAdvTimer = setInterval(function () {
          var tasks = state.bcTasks || []
          var active = tasks.some(function (t) { return t.state === 'queued' || t.state === 'sending' })
          if (!active) { clearInterval(bcAdvTimer); bcAdvTimer = null; return }
          loadBroadcastTasks(true, false)
        }, 3000)
      }
      function bindBroadcastEvents() {
        if (!panel) return
        var sendB = panel.querySelector('#dk-roster-send')
        if (sendB) sendB.onclick = function () { openBroadcastDraft('') }
        // ↩ 撤回勾选项最近消息(2026-09-12): 选目标页与广播页共用同一个按钮 id(tab 互斥渲染)
        var recallB = panel.querySelector('#dk-roster-recall')
        if (recallB) recallB.onclick = function () { recallSelectedLast() }
        // 广播子页: 跳去「📇 群组管理」勾选目标(2026-09-10)
        var gotoB = panel.querySelector('#dk-bc-goto')
        if (gotoB) gotoB.onclick = function () { state.tab = 'roster'; paintBody(); bindBodyEvents() }
        var cc = panel.querySelector('#dk-bc-cancel')
        if (cc) cc.onclick = function () { state.bcDraft = null; paintBody() }
        var cf = panel.querySelector('#dk-bc-confirm')
        if (cf) cf.onclick = function () {
          if (!state.bcDraft) return
          var ta = panel.querySelector('#dk-bc-text')
          var text = ta ? ta.value.trim() : state.bcDraft.text
          if (!text) { bcHint('内容不能为空'); return }
          var targets = state.bcDraft.targets
          bcHint('发送中…')
          apiPost('group/broadcast/create', { ns: state.ns || undefined, type: 'text', text: text, targets: targets }).then(function (d) {
            if (!d || !d.ok || !d.task) { bcHint('❌ ' + ((d && d.error) || '创建失败')); return }
            // 二次确认: 已弹「确认群发」按钮, 这里直接 confirm 入队
            return apiPost('group/broadcast/confirm', { ns: state.ns || undefined, task_id: d.task.task_id }).then(function (d2) {
              state.bcDraft = null
              if (d2 && d2.ok) {
                // 2026-09-12 修: 确认后**切到「📢 广播」子页** —— 任务列表(含逐目标撤回)只在该页渲染,
                // 以前留在「🎯 选目标」页: 界面毫无变化(主人以为没反应/是 bug), 也从来没见过撤回按钮。
                state.tab = 'broadcast'
                state.msg = '✅ 已确认群发 ' + targets.length + ' 个目标(逐目标发送中, 2 分钟内可逐目标撤回)'
                paintBody(); bindBodyEvents()
                loadBroadcastTasks(true)
                startBroadcastAdvance()
              } else { bcHint('❌ ' + ((d2 && (d2.msg || d2.error)) || '确认失败')) }
            })
          }).catch(function () { bcHint('❌ 创建异常') })
        }
        var refreshB = panel.querySelector('#dk-bc-refresh')
        if (refreshB) refreshB.onclick = function () { loadBroadcastTasks(true) }
        var tlist = panel.querySelector('#dk-bc-tasks')
        if (tlist) tlist.onclick = function (e) {
          var b = e.target
          var cn = b.getAttribute && b.getAttribute('data-bccancel')
          if (cn) { apiPost('group/broadcast/cancel', { ns: state.ns || undefined, task_id: cn }).then(function () { loadBroadcastTasks(true) }); return }
          // 逐目标撤回(2026-09-12 重做): 任务卡片里每个"已发出"的目标自带「↩ 撤回」按钮, 点一下直接撤 ——
          // 不再弹 window.prompt 让主人手填 peerId 后 6 位(旧交互隐蔽又别扭, 主人根本没找到过)。
          var r1 = b.getAttribute && b.getAttribute('data-bcrecall1')
          if (r1) {
            var parts = String(r1).split('|')
            var t1 = (state.bcTasks || []).find(function (x) { return x.task_id === parts[0] })
            var who = t1 && t1.targets.find(function (t2) { return t2.peerId === parts[1] })
            bcHint('撤回中…')
            apiPost('group/broadcast/recall', { ns: state.ns || undefined, task_id: parts[0], peerId: parts[1] }).then(function (d) {
              bcHint(d && d.ok ? ('✅ 已撤回 ' + ((who && who.name) || parts[1])) : ('❌ ' + ((d && d.err) || '撤回失败')))
              loadBroadcastTasks(false)
            })
            return
          }
        }
      }
      // ── 📝 Markdown 卡片编辑器(2026-09-10): 源码+实时预览+按钮 → send-card 发送 ──
      function mdEscapeHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') }
      function mdRender(src) {
        var s = String(src || '')
        // 代码块(先保护)
        var codeBlocks = []
        s = s.replace(/```([\s\S]*?)```/g, function (_, c) { codeBlocks.push(c); return '\u0000CODE' + (codeBlocks.length - 1) + '\u0000' })
        var lines = s.split('\n')
        var html = '', inList = false, inTable = false, table = []
        function closeList() { if (inList) { html += '</ul>'; inList = false } }
        function closeTable() { if (inTable) { html += '</table>'; inTable = false } }
        lines.forEach(function (line) {
          var t = line.trim()
          if (t === '') { closeList(); closeTable(); html += '<div style="height:6px"></div>'; return }
          if (/^```/.test(t)) return
          if (/^\u0000CODE\d+\u0000$/.test(t)) { closeList(); closeTable(); var i = parseInt(t.replace(/\D/g, ''), 10); html += '<pre style="background:#f6f8fa;border-radius:4px;padding:6px;font-size:11px;overflow:auto;margin:2px 0">' + mdEscapeHtml(codeBlocks[i]) + '</pre>'; return }
          var inline = function (x) {
            x = x.replace(/!\[([^\]]*)\]\(([^)\s]+)(?: #(\d+)px #(\d+)px)?\)/g, function (_, alt, url, w, h) { var st = w ? ' style="width:' + w + 'px;height:' + (h || 'auto') + 'px"' : ''; return '<img src="' + mdEscapeHtml(url) + '" alt="' + mdEscapeHtml(alt || '') + '"' + st + ' style="max-width:100%;border-radius:6px;margin:2px 0">' })
            x = x.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="' + '$2' + '" target="_blank" style="color:#4b7bec">$1</a>')
            x = x.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/\*([^*]+)\*/g, '<i>$1</i>').replace(/`([^`]+)`/g, '<code style="background:#f1f3f5;border-radius:3px;padding:0 3px">$1</code>')
            return x
          }
          if (/^###\s+/.test(t)) { closeList(); closeTable(); html += '<div style="font-weight:700;font-size:13px;margin:4px 0 2px">' + inline(t.replace(/^###\s+/, '')) + '</div>' }
          else if (/^##\s+/.test(t)) { closeList(); closeTable(); html += '<div style="font-weight:700;font-size:15px;margin:4px 0 2px">' + inline(t.replace(/^##\s+/, '')) + '</div>' }
          else if (/^#\s+/.test(t)) { closeList(); closeTable(); html += '<div style="font-weight:700;font-size:17px;margin:4px 0 2px">' + inline(t.replace(/^#\s+/, '')) + '</div>' }
          else if (/^>\s*/.test(t)) { closeList(); closeTable(); html += '<div style="border-left:3px solid #4b7bec;padding:2px 8px;color:#666;background:#f4f7ff;border-radius:0 4px 4px 0;margin:2px 0">' + inline(t.replace(/^>\s*/, '')) + '</div>' }
          else if (/^[-*]\s+/.test(t)) { closeTable(); if (!inList) { inList = true; html += '<ul style="margin:2px 0;padding-left:18px">' } html += '<li>' + inline(t.replace(/^[-*]\s+/, '')) + '</li>' }
          else if (/^\d+\.\s+/.test(t)) { closeTable(); if (!inList) { inList = true; html += '<ul style="margin:2px 0;padding-left:18px">' } html += '<li>' + inline(t.replace(/^\d+\.\s+/, '')) + '</li>' }
          else if (/^\|/.test(t)) {
            closeList()
            var cells = t.replace(/^\||\|$/g, '').split('|').map(function (c) { return c.trim() })
            if (/^[-:]+$/.test(cells.join('')) && table.length) { return } // 分隔行跳过
            if (!inTable) { inTable = true; table = []; html += '<table style="border-collapse:collapse;font-size:11px;margin:2px 0"><tr>' }
            html += '<tr>' + cells.map(function (c) { return '<td style="border:1px solid #dde;padding:2px 6px">' + inline(c) + '</td>' }).join('') + '</tr>'
          }
          else { closeList(); closeTable(); html += '<div style="margin:2px 0">' + inline(t) + '</div>' }
        })
        closeList(); closeTable()
        return html
      }
      // 按钮动作判定(2026-09-10 主人要求: 卡片按钮要能写「回文本 / 跳链接 / 执行命令」):
      //   第三段显式指定 → url/链接 | cmd/命令 | text/回复; 不写则智能判断:
      //     以 http(s) 开头 = 跳链接; 以 / 开头 = 执行命令; 其余 = 回文本
      function cardBtnAction(typeRaw, data, hasType) {
        var t = String(typeRaw || '').toLowerCase()
        if (hasType) {
          if (t === 'url' || t === 'link' || t === '跳转') return 'url'
          if (t === 'cmd' || t === 'command' || t === '命令') return 'cmd'
          if (t === 'text' || t === 'reply' || t === '文本') return 'text'
        }
        if (/^https?:\/\//i.test(data)) return 'url'
        if (String(data).charAt(0) === '/') return 'cmd'
        return 'text'
      }
      function parseCardButtons(text) {
        // 每行: 文字|内容 或 文字|内容|url|cmd|text
        var out = []
        var rows = String(text || '').split('\n').map(function (s) { return s.trim() }).filter(Boolean)
        for (var i = 0; i < rows.length; i++) {
          var parts = rows[i].split('|').map(function (s) { return s.trim() })
          if (parts.length < 2 || !parts[0]) continue
          var label = parts[0], data = parts[1]
          var action = cardBtnAction(parts.length >= 3 ? parts[2] : '', data, parts.length >= 3)
          out.push({ id: 'btn' + (i + 1), label: label, data: data, action: action, isUrl: action === 'url' })
        }
        return out
      }
      function bindCardEvents() {
        if (!panel) return
        var q = function (sel) { return panel.querySelector(sel) }
        var mdEl = q('#dk-card-md')
        var prevEl = q('#dk-card-preview')
        var render = function () { if (mdEl && prevEl) prevEl.innerHTML = mdRender(mdEl.value) }
        if (mdEl) mdEl.oninput = function () { state.cardMd = mdEl.value; render() }
        var btnsEl = q('#dk-card-btns')
        if (btnsEl) btnsEl.oninput = function () { state.cardBtns = btnsEl.value }
        var gsel = q('#dk-card-gid')
        if (gsel) {
          // 默认目标同步: 避免"没手动选过"就报未选目标(2026-09-10 修复)
          if (gsel.value && !state.cardGid) state.cardGid = gsel.value
          gsel.onchange = function () { state.cardGid = gsel.value }
        }
        // 目标搜索(2026-09-10 主人要求): 输入即过滤群/私聊列表
        var cq = q('#dk-card-q')
        if (cq) {
          cq.value = state.cardQ || ''
          cq.oninput = function () { state.cardQ = cq.value }
          cq.onchange = function () { state.cardQ = cq.value; paintBody() }
          cq.onkeydown = function (e) { if (e && e.key === 'Enter') { state.cardQ = cq.value; paintBody() } }
        }
        render()
        var chHint = function (t) { var h = q('#dk-card-hint'); if (h) h.textContent = t || '' }
        // 实时读当前值: DOM 可能被 paintBody 重建, 不能依赖绑定时捕获的引用(2026-09-10 修复发送无反应)
        var readCard = function () {
          var m = q('#dk-card-md'), b = q('#dk-card-btns'), g = q('#dk-card-gid')
          var md = m ? m.value.trim() : String(state.cardMd || '').trim()
          var btns = parseCardButtons(b ? b.value : (state.cardBtns || ''))
          var raw = String((g && g.value) || state.cardGid || '')
          var isC2c = raw.indexOf('c2c:') === 0
          return { md: md, btns: btns, raw: raw, gid: isC2c ? '' : raw, openid: isC2c ? raw.slice(4) : '' }
        }
        var sendB = q('#dk-card-send')
        if (sendB) sendB.onclick = function () {
          var v = readCard()
          if (!v.md) { chHint('markdown 内容不能为空'); return }
          if (!v.raw) { chHint('请先选目标(群或私聊)'); return }
          state.cardBusy = 'card'; sendB.disabled = true; chHint(v.openid ? '发送中(私聊)…' : '发送中(群)…')
          // 按钮走结构化路径交给 host: host 生成 cardId + 回调表(回文本/执行命令靠它), 并编好 bpk: 键盘
          var cardButtons = v.btns.map(function (b) { return { label: b.label, action: b.action, payload: b.data } })
          apiPost('chat/send-card', { ns: state.ns || undefined, gid: v.gid || undefined, openid: v.openid || undefined, markdown: v.md, cardButtons: cardButtons.length ? cardButtons : undefined }).then(function (d) {
            state.cardBusy = ''; sendB.disabled = false
            chHint(d && d.ok ? ((d.msg || '✅ 卡片已发送!')) : ((d && d.err && d.err.human) || (d && d.error) || '发送失败'))
          }).catch(function () { state.cardBusy = ''; sendB.disabled = false; chHint('发送异常') })
        }
        // 💾 存为事件: 当前 markdown+按钮 → botplay 事件(独立文件, /botplay 一键发卡)
        var saveB = q('#dk-card-save')
        if (saveB) saveB.onclick = function () {
          var v = readCard()
          if (!v.md) { chHint('markdown 内容不能为空'); return }
          if (!v.btns.length) { chHint('请至少配一个按钮(存为事件需要按钮)'); return }
          state.cardBusy = 'save'; saveB.disabled = true; chHint('保存中…')
          api('group/botplay-events', state.ns ? 'ns=' + encodeURIComponent(state.ns) : '').then(function (d) {
            var events = (d && d.ok && Array.isArray(d.events)) ? d.events : []
            var ev = {
              id: 'card' + Date.now().toString(36).slice(-6),
              name: v.md.replace(/^#+\s*/, '').split('\n')[0].slice(0, 12) || '卡片',
              contentText: v.md, maxClicks: 0, expireSec: 600, buttonsPerRow: 1,
              perm: { type: 'all', userIds: [] },
              buttons: v.btns.map(function (b, i) {
                // 三型动作 → botplay 的 botAction(回文本/命令/跳转), 与卡片发送行为一致
                var act = b.action === 'url' ? { type: 'jump_url', text: '', url: b.data }
                  : (b.action === 'cmd' ? { type: 'command', text: b.data.replace(/^\//, ''), url: '' }
                    : { type: 'reply_text', text: b.data, url: '' })
                return { id: 'b' + (i + 1), label: b.label, style: 1, botAction: act, llmEffect: { mode: 'no_append', contextText: '' } }
              }),
            }
            events.push(ev)
            return apiPost('group/botplay-events', { ns: state.ns || 'im-qqbot', events: events }).then(function (d2) {
              state.cardBusy = ''; saveB.disabled = false
              chHint(d2 && d2.ok ? ('✅ 已存为事件「' + ev.name + '」(id=' + ev.id + '), 群内发 /botplay ' + ev.id + ' 可一键发卡') : '保存失败: ' + ((d2 && (d2.error || d2.msg)) || '未知错误'))
            })
          }).catch(function () { state.cardBusy = ''; saveB.disabled = false; chHint('保存异常') })
        }
        // 📤 卡片群发(2026-09-10 主人要求): 把当前卡片群发到「🎯 选目标」勾选的全部目标(二次确认)
        var bcB = q('#dk-card-broadcast')
        if (bcB) bcB.onclick = function () {
          var v = readCard()
          if (!v.md) { chHint('markdown 内容不能为空'); return }
          var tg = (typeof rosterSelectedTargets === 'function') ? rosterSelectedTargets() : []
          if (!tg.length) { chHint('先在「🎯 选目标」里勾选要群发的目标'); return }
          if (!window.confirm('确认把这卡片群发到 ' + tg.length + ' 个目标?\n\n' + tg.slice(0, 8).map(function (t2) { return '· ' + (t2.name || t2.peerId) }).join('\n') + (tg.length > 8 ? '\n…' : '') + '\n\n(高影响操作, 发送后 2 分钟内可逐目标撤回)')) return
          state.cardBusy = 'bc'; bcB.disabled = true; chHint('创建群发任务…')
          var cardButtons2 = v.btns.map(function (b) { return { label: b.label, action: b.action, payload: b.data } })
          apiPost('group/broadcast/create', { ns: state.ns || undefined, type: 'card', text: v.md, cardButtons: cardButtons2.length ? cardButtons2 : undefined, targets: tg }).then(function (d) {
            if (!d || !d.ok || !d.task) { state.cardBusy = ''; bcB.disabled = false; chHint((d && d.error) || '创建失败'); return }
            return apiPost('group/broadcast/confirm', { ns: state.ns || undefined, task_id: d.task.task_id }).then(function (d2) {
              state.cardBusy = ''; bcB.disabled = false
              chHint(d2 && d2.ok ? ('✅ 已确认群发卡片到 ' + tg.length + ' 个目标(后台逐条发送)') : ((d2 && (d2.msg || d2.error)) || '确认失败'))
              loadBroadcastTasks(false, true)
            })
          }).catch(function () { state.cardBusy = ''; bcB.disabled = false; chHint('群发异常') })
        }
      }
      function sendNow() {
        var t = (state.sendText || '').trim()
        if (!t) { state.msg = '先输入内容'; paintBody(); return }
        state.busy = 'send'; paintBody()
        var body = { text: t, ns: state.ns || undefined, insertContext: state.insertCtx === true }
        if (state.sendScope === 'c2c') {
          if (!state.sendTo) { state.msg = '先选私聊对象'; state.busy = ''; paintBody(); return }
          body.openid = state.sendTo
        } else {
          if (!state.gid) { state.msg = '先选群'; state.busy = ''; paintBody(); return }
          body.gid = state.gid
        }
        apiPost(state.sendScope === 'c2c' ? 'chat/send' : 'group/send', body).then(function (d) {
          state.busy = ''
          state.msg = (d && (d.msg || (d.err && d.err.human))) || (d && d.error) || '发送结果未知'
          if (d && d.ok) state.sendText = ''
          paintBody()
        })
      }
      function loadJoins() {
        state.joins = null; paintBody()
        if (!state.gid) { state.joins = []; paintBody(); return }
        var q = 'gid=' + encodeURIComponent(state.gid) + (state.ns ? '&ns=' + encodeURIComponent(state.ns) : '')
        api('group/join_requests', q).then(function (d) {
          state.joins = (d && d.ok && Array.isArray(d.list) ? d.list : []).map(function (j) { return { member_openid: j.member_openid, username: j.username || '(未知昵称)', verify: j.verify_human || (j.verify_info && (j.verify_info.verify_message || j.verify_info.method)) || '', risk: j.risk_tips || '', source: j.apply_source === 'invited' ? '被邀请' : '主动申请' } })
          paintBody()
        })
      }
      function doApprove(mid, op) {
        var reason = op === 'decline' ? window.prompt('拒绝理由(可留空)') : '-'
        if (op === 'decline' && reason === null) return
        state.busy = 'ap-' + mid; paintBody()
        apiPost('group/approve', { ns: state.ns || undefined, gid: state.gid, member_openid: mid, op: op, reason: reason || '' }).then(function (d) {
          state.busy = ''
          state.msg = (d && (d.msg || (d.err && d.err.human))) || '审批结果未知'
          refreshBadge(); loadJoins()
        })
      }
      function loadMutes() {
        state.mutes = null; state.members = null; paintBody()
        if (!state.gid) { state.mutes = []; state.members = []; paintBody(); return }
        var q = 'gid=' + encodeURIComponent(state.gid) + (state.ns ? '&ns=' + encodeURIComponent(state.ns) : '')
        api('group/mute_state', q).then(function (d) {
          var ms = (d && d.ok && d.data && Array.isArray(d.data.members) ? d.data.members : [])
          state.mutes = ms.map(function (m) { return { member_openid: m.member_openid, username: m.username || '', expire: m.mute_expire_at || '' } })
          paintBody()
        })
        api('group/members_local', q).then(function (d) {
          state.members = (d && d.ok && Array.isArray(d.members) ? d.members : []).map(function (m) { return { mid: m.mid, name: m.name || '' } })
          paintBody()
        })
      }
      function doMute(mid, action, seconds) {
        var secs = action === 'mute' ? Math.max(1, Math.round(Number(seconds || 600))) : 0
        state.busy = 'm-' + mid; paintBody()
        apiPost('group/mute', { ns: state.ns || undefined, gid: state.gid, member_openid: mid, action: action, seconds: secs }).then(function (d) {
          state.busy = ''
          state.msg = (d && (d.msg || (d.err && d.err.human))) || '操作结果未知'
          loadMutes(); refreshBadge()
        })
      }
      function doBind() {
        var g = (state.bindGid || '').trim()
        if (!g) { state.msg = '先粘贴 group_openid'; paintBody(); return }
        apiPost('group/bind', { ns: state.ns || undefined, gid: g, name: (state.bindName || '').trim() }).then(function (d) {
          if (d && d.ok) { state.msg = '已登记群 ✓'; state.bindGid = ''; state.bindName = ''; loadGroups() }
          else state.msg = (d && d.error) || '绑定失败'
          paintBody()
        })
      }

      function paintHead() {
        if (!panel || !open) return
        var h = panel.querySelector('.dk-h')
        if (!h) return
        var opts = state.accts.map(function (a) { return '<option value="' + esc(a.ns) + '"' + (a.ns === state.ns ? ' selected' : '') + '>' + esc(a.ns) + (a.appId ? ' (' + a.appId + ')' : '') + (a.disabled ? ' [停用]' : '') + '</option>' }).join('')
        h.innerHTML = '<span>🛡 QQ 群管理台</span>'
          + '<select class="qqs-sel" id="dk-ns" style="max-width:220px">' + (opts || '<option value="">无账号(去账号页添加)</option>') + '</select>'
          + '<span style="flex:1"></span>'
          + '<span class="dk-msg" id="dk-headmsg" style="color:#888;font-size:12px">直连 QQ 官方 · 面板操作 = 主人直发</span>'
          + '<button class="dk-btn" id="dk-full" title="全屏/还原">⛶</button>'
          + '<button class="dk-btn" id="dk-close" title="收回成球">➖</button>'
        var fb = h.querySelector('#dk-full')
        if (fb) fb.onclick = function (e) { e.stopPropagation(); var fs = panel.classList.toggle('dk-full'); fb.textContent = fs ? '🗗' : '⛶'; setTimeout(layoutPanel, 0) }
        h.querySelector('#dk-close').onclick = function () { closePanel(); ball.style.display = 'block' }
        h.querySelector('#dk-ns').onchange = function (e) {
          state.ns = e.target.value; state.gid = ''; state.sendTo = ''; state.sendName = ''; state.wantPeer = null; state.msg = ''
          refreshAll(); paintHead()
        }
      }
      function applyTargetFilter(panel, state) {
        var q = String(state.targetQ || '').trim().toLowerCase()
        var scope = state.sendScope
        var sel = scope === 'c2c' ? panel.querySelector('#dk-c2c') : panel.querySelector('#dk-gid')
        if (!sel) return
        var selVal = scope === 'c2c' ? state.sendTo : state.gid
        var opts = sel.querySelectorAll('option')
        var shown = 0, total = 0
        for (var i = 0; i < opts.length; i++) {
          var o = opts[i]
          total++
          var keep = !q || o.textContent.toLowerCase().indexOf(q) >= 0 || o.value === selVal
          o.hidden = !keep
          if (keep) shown++
        }
        var cnt = panel.querySelector('#dk-target-count')
        if (cnt) cnt.textContent = q ? ('匹配 ' + shown + '/' + total) : ''
      }
      // 📤 群发 次级标签栏(2026-09-10 主人要求: 互动事件/卡片并入主级「群发」)
      // 四个子页共享此栏: ✉️发送消息(send) / 📢广播(broadcast) / 🎮互动事件(bp) / 📝卡片(card)
      function sendSubTabs() {
        return '<div class="dk-row" style="gap:4px;margin:4px 0 6px;flex-wrap:wrap;border-bottom:1px dashed #e2d9ff;padding-bottom:6px">'
          + [['send', '🎯 选目标'], ['broadcast', '📢 广播'], ['bp', '🎮 互动事件'], ['card', '📝 卡片']]
            .map(function (s) {
              return '<button class="dk-btn' + (state.tab === s[0] ? ' on' : '') + '" data-subtab="' + s[0] + '">' + s[1] + '</button>'
            }).join('')
          + '</div>'
      }
      // ⚙ 单会话设置 · 次级标签栏(2026-09-13 主人要求: 智能回复独立成子标签, 另留一个空标签当样板)
      function sessionSubTabs() {
        var st = state.stTab || 'lm'
        return '<div class="dk-row" style="gap:4px;margin:4px 0 6px;flex-wrap:wrap;border-bottom:1px dashed #e2d9ff;padding-bottom:6px">'
          + [['lm', '🧠 智能回复'], ['blank', '📄 空白样板']]
            .map(function (s) {
              return '<button class="dk-btn' + (st === s[0] ? ' on' : '') + '" data-sttab="' + s[0] + '">' + s[1] + '</button>'
            }).join('')
          + '</div>'
      }
      // 🚀 M3 群发面板(确认草稿 + 任务列表); 「📇群组管理」与「📤群发·广播」共用(2026-09-10 抽函数)
      function broadcastPanel() {
        if (!state.bcDraft && !(state.bcTasks && state.bcTasks.length)) return ''
        var out = '<div style="border:1px solid #d3f0d3;border-radius:8px;padding:6px 8px;margin:6px 0;background:#f6fdf6">'
        if (state.bcDraft) {
          var bc = state.bcDraft
          out += '<div class="dk-row"><b style="font-size:13px">🚀 群发确认(M3)</b>'
            + '<span class="dk-msg" style="flex:1;text-align:right;color:#666;font-size:11px">' + bc.targets.length + ' 个目标</span></div>'
          out += '<textarea class="qqs-txt" id="dk-bc-text" style="width:100%;box-sizing:border-box;min-height:64px;font-size:12px;margin:2px 0" placeholder="要群发的内容…">' + esc(bc.text) + '</textarea>'
          out += '<div class="dk-item" style="border:1px solid #eef7ee;border-radius:6px;margin:1px 0;padding:3px 6px;max-height:14vh;overflow:auto">'
          bc.targets.forEach(function (t2) {
            out += '<div style="font-size:11px;color:#555;line-height:1.5">' + (t2.scope === 'group' ? '👥' : '👤') + ' ' + esc(t2.name || String(t2.peerId).slice(0, 12)) + ' <span style="color:#aaa">…' + esc(String(t2.peerId).slice(-6)) + '</span></div>'
          })
          out += '</div>'
          out += '<div class="dk-row" style="gap:8px">'
            + '<button class="dk-btn no" id="dk-bc-cancel">✕ 取消</button>'
            + '<button class="dk-btn ok" id="dk-bc-confirm">✅ 确认群发(发 ' + bc.targets.length + ' 个目标)</button>'
            + '<span class="dk-msg" style="flex:1;text-align:right;font-size:11px;color:#c23131">⚠️ 高影响操作: 发送后 2 分钟内可逐目标撤回</span></div>'
        }
        // 反馈行(2026-09-12 修): bcHint() 一直在找 `#dk-bc-hint`, 但本面板从未渲染过这个元素
        // → 点「确认群发」后界面**零反馈**(消息其实已经发出去了, 主人以为没反应/是 bug)。
        out += '<div class="dk-row"><span class="dk-msg" id="dk-bc-hint" style="color:#2f9e44;font-size:12px;margin:2px 0"></span></div>'
        if (state.bcTasks && state.bcTasks.length) {
          out += '<div class="dk-row"><b style="font-size:12px">📋 群发任务</b>'
            + '<button class="dk-btn" id="dk-bc-refresh" style="margin-left:auto">🔄 刷新进度</button></div>'
          state.bcTasks.forEach(function (tk) {
            var stc = { draft: '#888', queued: '#1971c2', sending: '#f08c00', partial_failed: '#e03131', done: '#2f9e44', cancelled: '#868e96' }[tk.state] || '#888'
            var okN = tk.targets.filter(function (t2) { return tk.results[t2.peerId] && tk.results[t2.peerId].ok }).length
            // 2 分钟撤回窗口(以服务端为准): 从任务完成时刻起算的剩余秒数
            var left = ''
            if ((tk.state === 'done' || tk.state === 'partial_failed') && tk.done_at) {
              var sec = Math.floor((tk.done_at + 120000 - Date.now()) / 1000)
              left = sec > 0 ? ('可撤 ' + sec + 's') : '已过撤回窗口'
            }
            out += '<div class="dk-item" style="border:1px solid #eee;border-radius:6px;margin:2px 0;padding:4px 6px;display:block">'
              + '<div style="display:flex;align-items:center;gap:6px">'
              + '<span style="font-size:11px;font-weight:700;color:' + stc + '">' + ({ draft: '草稿', queued: '排队中', sending: '发送中', partial_failed: '部分失败', done: '已完成', cancelled: '已中止' }[tk.state] || tk.state) + '</span>'
              + '<span style="flex:1;font-size:11px;color:#555;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"> ' + esc(String(tk.payload.content || '').slice(0, 30)) + '</span>'
              + '<span style="font-size:11px;color:#666">' + okN + '/' + tk.targets.length + (left ? ' · ' + left : '') + '</span>'
              + (tk.state === 'queued' || tk.state === 'sending' ? '<button class="dk-btn no" data-bccancel="' + esc(tk.task_id) + '" style="margin-left:6px">⏹ 中止</button>' : '')
              + '</div>'
            // 逐目标明细 + 该目标的「↩ 撤回」(2026-09-12): 谁发出去了、谁失败了、谁能撤, 一眼看清
            tk.targets.forEach(function (t2) {
              var r2 = tk.results && tk.results[t2.peerId]
              var mark = !r2 ? '⏳ 待发' : (r2.ok ? '✅ 已发' : ('❌ ' + esc(String(r2.err || '失败'))))
              out += '<div style="display:flex;align-items:center;gap:6px;font-size:11px;color:#555;padding-left:6px">'
                + '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + (t2.scope === 'group' ? '👥' : '👤') + ' ' + esc(t2.name || String(t2.peerId).slice(0, 12)) + ' <span style="color:#aaa">…' + esc(String(t2.peerId).slice(-4)) + '</span> ' + mark + '</span>'
                + (r2 && r2.ok ? '<button class="dk-btn no" data-bcrecall1="' + esc(tk.task_id) + '|' + esc(t2.peerId) + '" style="font-size:11px">↩ 撤回</button>' : '')
                + '</div>'
            })
            out += '</div>'
          })
        }
        out += '</div>'
        return out
      }
      function paintBody() {
        if (!panel || !open) return
        var b = panel.querySelector('.dk-b')
        if (!b) return
        var groupOpts = state.groups.map(function (g) {
          var tail = g.gid.length > 8 ? '…' + g.gid.slice(-6) : g.gid
          var label = g.name ? (g.name + ' (' + tail + ')') : ('群 ' + tail)
          return '<option value="' + esc(g.gid) + '"' + (g.gid === state.gid ? ' selected' : '') + '>' + esc(label) + (g.from ? ' [' + g.from + ']' : '') + '</option>'
        }).join('')
        var groupSelHtml = '<select class="qqs-sel" id="dk-gid" style="min-width:220px">' + (groupOpts || '<option value="">暂无群(可于下方登记)</option>') + '</select>'
        var c2cOpts = state.c2cs.map(function (c) {
          var tail = c.id.length > 8 ? '…' + c.id.slice(-6) : c.id
          var label = c.name ? (c.name + ' (' + tail + ')') : ('私聊 ' + tail)
          return '<option value="' + esc(c.id) + '"' + (c.id === state.sendTo ? ' selected' : '') + '>' + esc(label) + '</option>'
        }).join('')
        var tabs = '<div class="dk-tab">'
          + '<button data-t="roster" class="' + (state.tab === 'roster' ? 'on' : '') + '">📇 群组管理</button>'
          + '<button data-t="chat" class="' + (state.tab === 'chat' ? 'on' : '') + '">💬 聊天</button>'
          + '<button data-t="join" class="' + (state.tab === 'join' ? 'on' : '') + '">📥 入群审批<span class="dk-join-badge" style="display:none;background:#ff4d4f;color:#fff;border-radius:8px;font-size:11px;padding:0 5px;margin-left:4px">0</span></button>'
          + '<button data-t="mute" class="' + (state.tab === 'mute' ? 'on' : '') + '">🔇 禁言</button>'
          + '<button data-t="out" class="' + (state.tab === 'out' ? 'on' : '') + '">⚙️ 出站</button>'
          + '<button data-t="send" class="' + (['send','broadcast','bp','card'].indexOf(state.tab) >= 0 ? 'on' : '') + '">📤 群发</button>'
          + '<button data-t="session" class="' + (state.tab === 'session' ? 'on' : '') + '">⚙ 单会话设置</button>'
          + '</div>'
        var body = tabs
        var status = state.msg ? '<div class="dk-msg" style="color:#2f9e44;margin:4px 0">' + esc(state.msg) + '</div>' : ''
        if (!state.ns || state.accts.length === 0) {
          body += '<div class="dk-empty">还没有配置机器人账号 → 到「账号与预设」页添加后再回来</div>'
        } else if (state.tab === 'send') {
          // 🎯 选目标(2026-09-10 主人要求): 把原「发送消息」改成勾选式的目标选择器,
          // 分组(群/私聊)+搜索, 与「📇 群组管理」共用同一份勾选(state.rosterSel) → 供 📢 广播 群发。
          body += sendSubTabs()
          body += '<div class="dk-row" style="font-weight:700;font-size:13px;margin:4px 0 2px">🎯 选目标(勾选后到「📢 广播」群发)</div>'
          body += '<div class="dk-row"><span class="dk-msg" style="flex:1;line-height:1.5">勾选要群发的 <b>👥群 / 👤私聊</b> 对象(与「📇 群组管理」共用同一份勾选)。可用 <b>🗂 分组</b> 把常用目标归组(仿 QQ 分组), 选好切到 <b>📢 广播</b> 发送。</span></div>'
          // 🗂 分组栏(仿 QQ 下拉分组 + 编辑, 2026-09-10 主人要求)
          var tg = (state.tgGroups || []).filter(function (g2) { return g2 && g2.id })
          body += '<div class="dk-row" style="gap:6px;margin:2px 0;flex-wrap:wrap">'
            + '<span style="font-size:12px;color:#666;flex:none">🗂 分组:</span>'
            + '<select class="qqs-sel" id="dk-tg-sel" style="min-width:140px">'
            + '<option value="">全部目标</option>'
            + tg.map(function (g2) { return '<option value="' + esc(g2.id) + '"' + (state.tgCur === g2.id ? ' selected' : '') + '>' + esc(g2.name || g2.id) + '（' + ((g2.members || []).length) + '）</option>' }).join('')
            + '</select>'
            + '<button class="dk-btn" id="dk-tg-new">➕ 新建分组</button>'
            + '<button class="dk-btn" id="dk-tg-rename"' + (state.tgCur ? '' : ' disabled') + '>✏️ 改名</button>'
            + '<button class="dk-btn no" id="dk-tg-del"' + (state.tgCur ? '' : ' disabled') + '>🗑 删除</button>'
            + '</div>'
          body += '<div class="dk-row" style="gap:6px;margin:0 0 4px;flex-wrap:wrap">'
            + '<button class="dk-btn ok" id="dk-tg-add"' + (state.tgCur ? '' : ' disabled') + ' title="把上面勾选的目标加入当前分组">➕ 勾选的加入本组</button>'
            + '<button class="dk-btn" id="dk-tg-remove"' + (state.tgCur ? '' : ' disabled') + ' title="把勾选的从当前分组移出">➖ 从本组移出</button>'
            + '<button class="dk-btn" id="dk-tg-pickall"' + (state.tgCur ? '' : ' disabled') + ' title="勾选当前分组的全部成员">☑ 选中本组</button>'
            + '<span class="dk-msg" style="font-size:11px;color:#888">分组已存到 host(与 AI 共用): 直接说"发给【分组名】"即可群发</span>'
            + '</div>'
          body += '<div class="dk-row">范围: '
            + '<label style="display:inline-flex;align-items:center;gap:4px;cursor:pointer;font-size:12px"><input type="radio" name="dk-rscope" value="all"' + (state.rosterScope === 'all' ? ' checked' : '') + '> 全部</label>'
            + '<label style="display:inline-flex;align-items:center;gap:4px;cursor:pointer;font-size:12px"><input type="radio" name="dk-rscope" value="c2c"' + (state.rosterScope === 'c2c' ? ' checked' : '') + '> 👤 私聊过的人</label>'
            + '<label style="display:inline-flex;align-items:center;gap:4px;cursor:pointer;font-size:12px"><input type="radio" name="dk-rscope" value="group"' + (state.rosterScope === 'group' ? ' checked' : '') + '> 👥 群</label>'
            + '<span style="flex:1"></span>'
            + '<button class="dk-btn" id="dk-roster-refresh" title="重新拉取群注册表+聊天台账">🔄 刷新</button></div>'
          body += '<div class="dk-row" style="margin:2px 0 4px">'
            + '<input class="qqs-txt" id="dk-roster-q" placeholder="🔍 搜群名/昵称/ID…" value="' + esc(state.rosterQ || '') + '" style="flex:1;box-sizing:border-box;font-size:12px;padding:4px 8px">'
            + '<span class="dk-msg" id="dk-roster-stat" style="white-space:nowrap"></span></div>'
          body += '<div class="dk-row" style="margin:0 0 4px">'
            + '<button class="dk-btn" id="dk-roster-all">全选(当前范围)</button>'
            + '<button class="dk-btn" id="dk-roster-clear">清空</button>'
            + '<span class="dk-msg" style="flex:1;text-align:right;color:#2f9e44">已选 ' + rosterSelN() + ' 个</span>'
            + '<button class="dk-btn ok" id="dk-pick-goto">📢 去广播 →</button></div>'
          body += '<div class="dk-list" id="dk-roster-list"></div>'
        } else if (state.tab === 'chat') {
          body += '<div class="dk-row">目标类型: '
            + '<label style="display:inline-flex;align-items:center;gap:4px"><input type="radio" name="dk-scope" value="group"' + (state.sendScope !== 'c2c' ? ' checked' : '') + '> 群聊</label> '
            + '<label style="display:inline-flex;align-items:center;gap:4px"><input type="radio" name="dk-scope" value="c2c"' + (state.sendScope === 'c2c' ? ' checked' : '') + '> 私聊</label></div>'
          body += '<div class="dk-row" style="margin:2px 0 4px">'
            + '<input class="qqs-txt" id="dk-target-search" placeholder="' + (state.sendScope === 'c2c' ? '🔍 搜私聊对象(昵称/ID)…' : '🔍 搜群(备注/昵称/ID)…') + '" value="' + esc(state.targetQ || '') + '" style="width:100%;box-sizing:border-box;font-size:12px;padding:4px 8px">'
            + '<span class="dk-msg" id="dk-target-count"></span></div>'
          var chatTargetSel = state.sendScope === 'c2c'
            ? '<select class="qqs-sel" id="dk-c2c" style="min-width:220px">' + (c2cOpts || '<option value="">暂无私聊对象</option>') + '</select>'
            : groupSelHtml
          body += '<div class="dk-row" id="dk-target-row">' + chatTargetSel + '</div>'
          body += '<div class="dk-chat-wrap">'
            + '<div class="dk-chat-head">'
            + '<button class="dk-btn ok" id="dk-chat-refresh">🔄 刷新</button>'
            + '<span class="dk-msg" id="dk-chat-status" style="flex:1">QQ 会话记录(注入/系统文本已滤)</span>'
            + '</div>'
            + '<div class="dk-chat-box" id="dk-chat-box"></div>'
            + '</div>'
          // QQ 风格输入栏: 文本发送; bbcode [MEDIA:图片|路径/链接] 支持本地图与网络图
          body += '<div class="dk-composer">'
            + '<div class="dk-at-pop" id="dk-at-pop"></div>'
            + '<textarea id="dk-chat-input" rows="2" placeholder="输入文字发送(群聊敲 @ 可搜成员); 📷插图/📎文件 把本地路径或网络链接变成 [MEDIA:图片|来源]">' + esc(state.chatText) + '</textarea>'
            + '<div class="dk-cbar">'
            + '<button class="dk-btn" id="dk-chat-ins" title="发送后写一条「用户代你发送」模拟消息进 bot 上下文(web 流可见)">🧠 ' + (state.chatIns ? '记入上下文' : '不记上下文') + '</button>'
            + '<span class="dk-msg" id="dk-chat-cnt" style="color:#b3b7bd">0/2000</span>'
            + '<span style="flex:1"></span>'
            + '<input type="file" id="dk-chat-file" multiple hidden>'
            + '<button class="dk-btn" id="dk-chat-add-file" title="选择本机文件(小文件自动上传, 大文件请直接输入本机路径)">📎 文件</button>'
            + '<button class="dk-btn" id="dk-chat-add-img" title="插入图片: 弹窗输入本机路径或网络图片地址 → 自动变成 [MEDIA:图片|来源]">📷 插图</button>'
            + '<button class="dk-send" id="dk-chat-send">发送</button>'
            + '</div>'
            + '</div>'
        } else if (state.tab === 'join') {
          body += '<div class="dk-row">目标群: ' + groupSelHtml
            + '<button class="dk-btn" id="dk-refresh-join">🔄 刷新</button>'
            + '<span class="dk-msg">机器人需为群管理员; 通过/拒绝直接生效</span></div>'
          body += '<div class="dk-list" id="dk-join-list"></div>'
        } else if (state.tab === 'mute') {
          body += '<div class="dk-row">目标群: ' + groupSelHtml
            + '<button class="dk-btn" id="dk-refresh-mute">🔄 刷新</button></div>'
          body += '<div class="dk-msg">全员禁言: 官方接口未开放 · 只能操作普通成员(群主/管理员不可禁)</div>'
          body += '<div style="font-weight:700;font-size:13px;margin:8px 0 4px">① 禁言成员(机器人见过的)</div>'
          body += '<div class="dk-list" id="dk-member-list"></div>'
          body += '<div style="font-weight:700;font-size:13px;margin:8px 0 4px">② 正在禁言中</div>'
          body += '<div class="dk-list" id="dk-mute-list"></div>'
        } else if (state.tab === 'roster') {
          body += '<div class="dk-row" style="font-weight:700;font-size:13px;margin:2px 0">📇 会话台账:机器人聊过的对象</div>'
          body += '<div class="dk-row"><span class="dk-msg" style="flex:1;line-height:1.5">👤 = 私聊过的人(有 c2c 会话,可直接发消息) · 👥 = 群(群成员≠私聊对象: 群里见过≠能私聊,只能群内@)</span></div>'
          body += '<div style="border:1px solid #e2d9ff;border-radius:8px;padding:6px 8px;margin:2px 0 6px;background:#faf8ff">'
            + '<div class="dk-row" style="margin:0"><b style="font-size:13px">🎯 群组管理器(M2)</b>'
            + '<span class="dk-msg" style="flex:1" id="dk-hub-status">' + hubStatusText() + '</span>'
            + '<button class="dk-btn ok" id="dk-hub-set"' + (state.hubBusy ? ' disabled' : '') + ' title="把当前 web 会话设为群组管理器: 各群群事件(入群申请/新成员加入/被拉群)将汇总注入此会话">📌 设为本会话</button>'
            + '<button class="dk-btn" id="dk-hub-clear"' + (state.hubSid ? '' : ' disabled') + '>取消</button></div>'
            + '<div class="dk-msg" id="dk-hub-hint" style="color:#2f9e44"></div></div>'
          // ⚙ 群组设置(热更新): 群管理开关 + 入群申请轮询 —— 集中在此, 保存即 live 生效
          body += '<div style="border:1px solid #e2d9ff;border-radius:8px;padding:6px 8px;margin:2px 0 6px;background:#faf8ff">'
            + '<div class="dk-row" style="margin:0"><b style="font-size:13px">⚙ 群组设置(热更新)</b>'
            + '<span class="dk-msg" style="flex:1" id="dk-ga-hint"></span></div>'
            + '<div class="dk-row" style="gap:8px;flex-wrap:wrap">'
            + '<label style="display:inline-flex;align-items:center;gap:4px;cursor:pointer;font-size:12px"><input type="checkbox" id="dk-ga-enabled"' + (state.gaEnabled ? ' checked' : '') + '> 群管理</label>'
            + '<label style="display:inline-flex;align-items:center;gap:4px;cursor:pointer;font-size:12px"><input type="checkbox" id="dk-ga-poll"' + (state.gaPoll ? ' checked' : '') + '> 轮询审批</label>'
            + '<label style="display:inline-flex;align-items:center;gap:4px;cursor:pointer;font-size:12px"><input type="checkbox" id="dk-ga-pollwake"' + (state.gaPollWake ? ' checked' : '') + '> 唤醒AI</label>'
            + '<label style="display:inline-flex;align-items:center;gap:4px;cursor:pointer;font-size:12px"><input type="checkbox" id="dk-ga-hubnotify"' + (state.gaHubNotify ? ' checked' : '') + '> 注入群管会话</label>'
            + '<label style="display:inline-flex;align-items:center;gap:4px;cursor:pointer;font-size:12px" title="取消勾选=只注入群组管理器会话, 普通群会话不再收到审批提醒"><input type="checkbox" id="dk-ga-notifygroup"' + (state.gaNotifyGroup ? ' checked' : '') + '> 通知普通群</label>'
            + '<label style="display:inline-flex;align-items:center;gap:4px;cursor:pointer;font-size:12px" title="唤醒申请所在群会话的AI处理审批(与「唤醒AI」分开设置, 2026-09-11 主人要求)"><input type="checkbox" id="dk-ga-wakegroup"' + (state.gaWakeGroup ? ' checked' : '') + '> 唤醒普通群AI</label>'
            + '</div>'
            + '<div class="dk-row" style="gap:8px;flex-wrap:wrap">'
            + '<span style="font-size:12px;color:#666;display:inline-flex;align-items:center;gap:4px">间隔 <input type="number" id="dk-ga-interval" min="1" value="' + (state.gaInterval || 5) + '" style="width:52px;font-size:12px;padding:2px 4px"> 分钟</span>'
            + '<span style="font-size:12px;color:#666;display:inline-flex;align-items:center;gap:4px">攒够<input type="number" id="dk-ga-mincount" min="1" value="' + (state.gaMinCount || 1) + '" style="width:44px;font-size:12px;padding:2px 4px">个才提醒</span>'
            + '<button class="dk-btn ok" id="dk-ga-save" style="margin-left:auto">💾 保存设置</button>'
            + '</div>'
            + '<div class="dk-msg" style="line-height:1.5;color:#888">轮询=定时拉各群审批列表, 有新增就唤醒AI提醒你(默认1个也报, 不攒死); 大量申请靠轮询周期自然攒批。保存即热更新, 不用重启。</div>'
            + '</div>'
          body += '<div class="dk-row">范围: '
            + '<label style="display:inline-flex;align-items:center;gap:4px;cursor:pointer;font-size:12px"><input type="radio" name="dk-rscope" value="all"' + (state.rosterScope === 'all' ? ' checked' : '') + '> 全部</label>'
            + '<label style="display:inline-flex;align-items:center;gap:4px;cursor:pointer;font-size:12px"><input type="radio" name="dk-rscope" value="c2c"' + (state.rosterScope === 'c2c' ? ' checked' : '') + '> 👤 私聊过的人</label>'
            + '<label style="display:inline-flex;align-items:center;gap:4px;cursor:pointer;font-size:12px"><input type="radio" name="dk-rscope" value="group"' + (state.rosterScope === 'group' ? ' checked' : '') + '> 👥 群</label>'
            + '<span style="flex:1"></span>'
            + '<button class="dk-btn" id="dk-roster-refresh" title="重新拉取群注册表+聊天台账">🔄 刷新</button></div>'
          body += '<div class="dk-row" style="margin:2px 0 4px">'
            + '<input class="qqs-txt" id="dk-roster-q" placeholder="🔍 搜昵称/群名/ID…" value="' + esc(state.rosterQ || '') + '" style="flex:1;box-sizing:border-box;font-size:12px;padding:4px 8px">'
            + '<span class="dk-msg" id="dk-roster-stat" style="white-space:nowrap"></span></div>'
          body += '<div class="dk-row" style="margin:0 0 4px">'
            + '<button class="dk-btn" id="dk-roster-all">全选(当前范围)</button>'
            + '<button class="dk-btn" id="dk-roster-clear">清空</button>'
            + '<span class="dk-msg" style="flex:1;text-align:right;color:#2f9e44">已选 ' + rosterSelN() + ' 个</span>'
            + '<button class="dk-btn ok" id="dk-roster-send">🚀 群发勾选项</button>'
            + '<button class="dk-btn no" id="dk-roster-recall" title="撤回这些目标最近一条广播消息(2 分钟内有效); 不用去任务列表翻 task_id">↩ 撤回勾选项最近消息</button></div>'
          body += '<div class="dk-row"><span class="dk-msg" id="dk-roster-hint" style="color:#2f9e44;font-size:12px"></span></div>'
          body += '<div class="dk-list" id="dk-roster-list"></div>'
          // ── M3 群发面板(与「📤 群发 · 广播」子页共用, 2026-09-10 抽成 broadcastPanel) ──
          body += broadcastPanel()
        } else if (state.tab === 'broadcast') {
          // 📢 广播子页(2026-09-10 主人要求: 群发并入「📤 群发」主标签; 目标复用 📇群组管理 的勾选)
          body += sendSubTabs()
          body += '<div class="dk-row" style="font-weight:700;font-size:13px;margin:4px 0 2px">📢 群发广播</div>'
          var btg = rosterSelectedTargets()
          body += '<div class="dk-row"><span class="dk-msg" style="flex:1;line-height:1.5">目标来自「📇 群组管理」里勾选的对象(当前已选 <b>' + btg.length + '</b> 个)。群发<b>一律二次确认</b>, 发送后 2 分钟内可逐目标撤回; 任务后台串行推进(天然限频)。</span></div>'
          body += '<div class="dk-row" style="gap:6px;flex-wrap:wrap">'
            + '<button class="dk-btn" id="dk-bc-goto">📇 去勾选目标</button>'
            + '<button class="dk-btn ok" id="dk-roster-send"' + (btg.length ? '' : ' disabled') + ' title="把勾选的目标纳入群发">🚀 群发勾选项</button>'
            + '<button class="dk-btn no" id="dk-roster-recall" title="撤回这些目标最近一条广播消息(2 分钟内有效)">↩ 撤回勾选项最近消息</button>'
            + '</div>'
          body += '<div class="dk-row"><span class="dk-msg" id="dk-roster-hint" style="color:#2f9e44;font-size:12px"></span></div>'
          if (btg.length) {
            body += '<div class="dk-item" style="border:1px solid #eef7ee;border-radius:6px;margin:4px 0;padding:3px 6px;max-height:16vh;overflow:auto">'
            btg.forEach(function (t2) {
              body += '<div style="font-size:11px;color:#555;line-height:1.5">' + (t2.scope === 'group' ? '👥' : '👤') + ' ' + esc(t2.name || String(t2.peerId).slice(0, 12)) + ' <span style="color:#aaa">…' + esc(String(t2.peerId).slice(-6)) + '</span></div>'
            })
            body += '</div>'
          }
          body += broadcastPanel()
        } else if (state.tab === 'out') {
          var om = state.outMode || 'adaptive'
          if (om === 'nothink') body += '<div class="dk-msg" style="color:#c23131;margin:2px 0">⚠️ 当前为「完全不思考」(设置页开启): QQ 入站不唤醒 AI。发 /outmode adaptive 可唤醒。</div>'
          body += '<div class="dk-row" style="font-weight:700;font-size:13px;margin:4px 0 2px">⇄ 出站方式(保存即热更新,不用重启)</div>'
          body += '<div class="dk-row">'
            + ['adaptive','detail','passive','silent'].map(function (m2) { return '<label style="display:inline-flex;align-items:center;gap:4px;cursor:pointer;font-size:12px;color:#333"><input type="radio" name="dk-outmode" value="' + m2 + '"' + (om === m2 ? ' checked' : '') + '> ' + (m2==='adaptive' ? '适配主动(推荐默认)' : (m2==='detail' ? '详细主动(连工具调用一起推)' : (m2==='passive' ? '被动(只回最后一句)' : '完全不出站(静默)'))) + '</label>' }).join('')
            + '</div>'
          body += '<div class="dk-msg" style="line-height:1.6">适配主动=和QQ有关的会话回复都发到QQ: 刚收到真人消息时前5条带引用回你(能看到回的是哪句), 第6条起自动转独立新消息, 连发不被QQ吞; 定时/后台等没有新真人消息的主动推送也走独立消息。'
          body += '详细主动=聊天行为与适配主动完全一样, 但额外把 AI 的工具调用(🔧 工具调用)与工具结果也推到 QQ —— 能在 QQ 上看她正在干什么; 消息会明显变多, 看完记得切回适配主动。'
          body += '被动=始终以「回复你那条」发出, 连发约4~5条后会被QQ吞掉。完全不出站=本机静默, 不向QQ发任何回复(AI 可用工具随时切回)。本开关对纯web(没绑QQ)的会话不生效。</div>'
          body += '<span class="dk-msg" id="dk-out-hint" style="color:#2f9e44;margin:4px 0"></span>'
        } else if (state.tab === 'session') {
          // ⚙ 单会话设置(2026-09-13 主人定): 放"每个会话单独生效"的设置。
          // 次级标签: 🧠 智能回复 / 📄 空白样板(留作以后加新设置的模板)。
          body += sessionSubTabs()
          var st = state.stTab || 'lm'
          if (st === 'blank') {
            body += '<div style="border:1px dashed #cfc7ee;border-radius:8px;padding:20px 14px;margin:8px 0;text-align:center;line-height:2">'
              + '<div style="font-size:15px;font-weight:700">📄 空白样板</div>'
              + '<div style="font-size:12px;color:#888">这块先空着 —— 以后要加"每个会话单独生效"的设置, 照这个子标签加就行。<br>'
              + '(做法: 加一个子标签值 + 一段渲染分支 + 需要的 host API, 就能长出一个新的子页)</div>'
              + '</div>'
          } else {
          var lm = state.localModel
          body += '<div class="dk-msg" style="line-height:1.6">让机器人在本机跑一个 23MB 的中文小模型(<b>零 token</b>): 价值评分(她该不该开口) + 表情包语义搜索 —— <b>模型缺失时自动关闭, 不影响任何现有功能</b>。</div>'
          if (!lm) {
            body += '<div class="dk-empty">读取中…(若长时间不动, 点「🔄 重新检测」)</div>'
          } else {
            var lmMb = lm.bytes ? (Math.round((lm.bytes / 1048576) * 10) / 10) : 0
            var lmState = lm.available ? ('✅ 已就绪' + (lmMb ? ' · ' + lmMb + ' MB' : '')) : ('⚠️ 未安装(缺 ' + (lm.missing || []).length + ' 个文件) —— 点右边「⬇️ 下载模型」即可')
            // ⚠️ 2026-09-13 会话级: 评分模式/门槛/启用 **优先取当前会话的覆盖项**(overrides[group:xxx]),
            //    没有则继承账号级默认; 界面用"继承/已单独设置"标出来。
            var lmCfg = state.lmCfg || {}
            var ovKeyV = curOvKey()
            var ov = (ovKeyV && lmCfg.overrides && lmCfg.overrides[ovKeyV]) || {}
            var hasOv = !!(typeof ov.enabled === 'boolean' || ov.valueGate || typeof ov.valueMinScore === 'number')
            var pickGate = function (v) { return (v === 'off' || v === 'log' || v === 'block') ? v : '' }
            var gateV = pickGate(ov.valueGate) || pickGate(lmCfg.valueGate) || pickGate(lm.valueGate) || 'log'
            var minV = (typeof ov.valueMinScore === 'number') ? ov.valueMinScore
              : ((typeof lmCfg.valueMinScore === 'number') ? lmCfg.valueMinScore
                : (typeof lm.valueMinScore === 'number' ? lm.valueMinScore : 0.5))
            var onV = (typeof ov.enabled === 'boolean') ? ov.enabled
              : ((typeof lmCfg.enabled === 'boolean') ? lmCfg.enabled : (lm.enabled !== false))
            body += '<div class="dk-row" style="font-weight:700;font-size:13px;margin:10px 0 2px">🧠 智能回复（本地小模型） · bge-small-zh-v1.5</div>'
            // 本会话标识 + 继承状态(让"单会话"名副其实: 一眼看出这套值是谁的)
            body += '<div class="dk-row" style="gap:8px;align-items:center;flex-wrap:wrap;margin:0 0 4px">'
              + '<span class="dk-msg" style="font-size:12px;color:#7c6bd6">本会话: ' + esc(curHitLabel()) + '</span>'
              + '<span class="dk-msg" style="font-size:11px;color:' + (hasOv ? '#2f9e44' : '#999') + '">'
              + (hasOv ? '✔ 已单独设置' : '（暂用账号默认）') + '</span>'
              + (hasOv ? '<button class="dk-btn" id="dk-lm-reset" style="font-size:11px;padding:1px 6px" title="删除本会话的单独设置, 恢复继承账号默认">↩ 恢复继承</button>' : '')
              + '</div>'
            body += '<div class="dk-row" style="gap:8px;flex-wrap:wrap;align-items:center">'
              + '<label style="display:inline-flex;align-items:center;gap:4px;font-size:12px;cursor:pointer"><input type="checkbox" id="dk-lm-on"' + (onV ? ' checked' : '') + '> 启用智能回复(省 token)</label>'
              + '<span class="dk-msg" style="font-size:12px;color:' + (lm.available ? '#2f9e44' : '#c23131') + '">' + esc(lmState) + '</span>'
              + '</div>'
            body += '<div class="dk-row" style="gap:6px;margin:4px 0;flex-wrap:wrap">'
              + '<input class="qqs-inp" id="dk-lm-dir" style="flex:1;min-width:200px" placeholder="模型目录(留空=默认 ~/.dsh/models/bge-small-zh)" value="' + esc(lm.modelDir || '') + '">'
              + '<button class="dk-btn" id="dk-lm-save">💾 保存</button>'
              + '<button class="dk-btn" id="dk-lm-check">🔄 重新检测</button>'
              + (lm.available ? '' : '<button class="dk-btn ok" id="dk-lm-dl">⬇️ 下载模型(自动)</button>')
              + '</div>'
            // 评分模式 + 门槛(2026-09-13): off=不评分 / log=只记录(默认观察期) / block=低分不唤醒
            body += '<div class="dk-row" style="gap:8px;flex-wrap:wrap;align-items:center;margin:6px 0 2px">'
              + '<span style="font-size:12px;color:#666">评分模式:</span>'
              + [['off', '不评分'], ['log', '只记录(先观察)'], ['block', '低分不唤醒']].map(function (m2) {
                return '<label style="display:inline-flex;align-items:center;gap:4px;font-size:12px;cursor:pointer"><input type="radio" name="dk-lm-gate" value="' + m2[0] + '"' + (gateV === m2[0] ? ' checked' : '') + '> ' + m2[1] + '</label>'
              }).join('')
              + '<span style="font-size:12px;color:#666">门槛:</span>'
              + '<input class="qqs-inp" id="dk-lm-min" type="number" step="0.01" min="0" max="1" style="width:78px" value="' + minV + '">'
              + '</div>'
            body += '<span class="dk-msg" id="dk-lm-hint" style="color:#2f9e44;margin:2px 0"></span>'
            // 📊 最近评分(观察期): 让主人直接看到"她是怎么被叫醒的"
            // 2026-09-13 二次修: 列表抽成 scoreListHtml + 独立 div, 由 refreshScoreList 做**局部刷新**
            // (只换这个 div 的内容, 不整块 paintBody) → 既不闪, 又能自动更新。
            body += '<div class="dk-row" style="font-weight:700;font-size:13px;margin:10px 0 2px;gap:8px;align-items:center;flex-wrap:wrap">'
              + '<span>📊 最近评分(观察期)</span>'
              + '<span class="dk-msg" style="font-size:11px;color:#7c6bd6" id="dk-vs-scope">' + esc(curHitLabel()) + '</span>'
              + '<button class="dk-btn" id="dk-vs-reload" style="font-size:12px;padding:1px 8px">🔄 刷新</button>'
              + '<span class="dk-msg" style="font-size:11px;color:#999">每 10 秒自动更新</span>'
              + '</div>'
            body += '<div id="dk-vs-box">' + scoreListHtml(state.valueScores) + '</div>'
            // 💗 好感度(观察期, 只统计不生效): 数据源 {dataRoot}/.qqbot/affinity.json
            body += '<div class="dk-row" style="font-weight:700;font-size:13px;margin:10px 0 2px">💗 好感度(观察期·只统计)</div>'
            body += '<div class="dk-msg" id="dk-aff-box" style="font-size:12px;color:#666;white-space:pre-wrap">' + (state.affHtml || '加载中…') + '</div>'
            // ✍️ 样例库编辑(2026-09-13 主人问"哪里写样本"): 直接改 jsonl, 保存后下一条消息生效
            body += '<div class="dk-row" style="font-weight:700;font-size:13px;margin:12px 0 2px;gap:8px;align-items:center;flex-wrap:wrap">'
              + '<span>✍️ 样例库(决定她的开口标准)</span>'
              + '<button class="dk-btn" id="dk-vs-edit-toggle" style="font-size:12px;padding:1px 8px">' + (state.vsOpen ? '收起' : '展开编辑') + '</button>'
              + '<button class="dk-btn ok" id="dk-vs-aiwrite" style="font-size:12px;padding:1px 8px" title="模拟一条用户消息唤醒她, 让她自己读聊天记录写样例(样例库位置+写法一起发过去)">🤖 让ai写(有聊天记录最好)</button>'
              + '<span class="dk-msg" style="font-size:11px;color:#999" id="dk-vs-stat"></span>'
              + '</div>'
            body += '<div id="dk-vs-editor" style="display:' + (state.vsOpen ? 'block' : 'none') + '">'
              + '<textarea class="qqs-area" id="dk-vs-text" style="width:100%;min-height:170px;font-family:monospace;font-size:11px" placeholder=\'一行一条 JSON: {"m":"群消息文本","y":1}   (y=1 她会想接话 / y=0 她不会理)\'></textarea>'
              + '<div class="dk-row" style="gap:6px;margin-top:4px;align-items:center;flex-wrap:wrap">'
              + '<button class="dk-btn ok" id="dk-vs-save">💾 保存样例库</button>'
              + '<span class="dk-msg" id="dk-vs-hint" style="color:#2f9e44"></span>'
              + '</div>'
              + '<div class="dk-msg" style="font-size:11px;color:#888;line-height:1.6">一行一条 JSON。保存后<b>下一条群消息</b>就按新样例判断(自动重载, 约 0.3 秒)。'
              + '想让她自己学 —— 群里说一句「<b>从最近的聊天记录总结一批样本</b>」, 她会读真实聊天记录提炼后写进来 ✧</div>'
              + '</div>'
            body += '<div class="dk-msg" style="font-size:12px;color:#888;line-height:1.6">'
              + (lm.available
                ? '模型加载是懒加载: 第一次用到(有群消息需要评分)才载入, 约 0.3 秒, 之后常驻内存(~150MB)。'
                : '点「⬇️ 下载模型」自动拉取(约 23MB, hf-mirror 优先/官方兜底, 1~2 分钟); 也可以自己下载后放进上面目录: '
                  + '<code>onnx/model_quantized.onnx</code> · <code>tokenizer.json</code> · <code>tokenizer_config.json</code> · <code>config.json</code>')
              + '</div>'
          }
          }
        } else if (state.tab === 'card') {
          // 📝 自定义 markdown 卡片(2026-09-10): 源码 + 实时预览 + 按钮配置 → 发送到选中群/私聊
          body += sendSubTabs()
          body += '<div class="dk-row" style="font-weight:700;font-size:13px;margin:4px 0 2px">📝 Markdown 卡片编辑器(自定义互动卡)</div>'
          body += '<div class="dk-row"><span class="dk-msg" style="flex:1;line-height:1.5">写 markdown(支持 <b>![图 #宽px #高px](网络图URL)</b> 嵌图) → 加按钮(每行一个, 格式 <b>文字|指令</b> 或 <b>文字|url|跳转</b>) → 选目标发送。markdown 图只能用<b>公网直链图</b>(带扩展名/有 Content-Length 的图床最稳)。</span></div>'
          // 目标: 群 + 私聊(c2c: 前缀) + 搜索过滤(2026-09-10 主人要求)
          // ⚠️ 字段名: 群对象用 gid(state.groups = {gid,name,from,lastAt}), 私聊对象用 id(state.c2cs)。
          //    2026-09-10 修复: 原写成 g.id → String(undefined)="undefined" → 请求打到
          //    /v2/groups/undefined/messages → 11255 invalid request(群里发不出去)。
          var cTargets = (state.groups || []).map(function (g) {
            var gid = String((g && (g.gid || g.id)) || '')
            return { v: gid, n: (g && g.name) || gid.slice(0, 8), kind: 'group' }
          }).filter(function (t) { return t.v && t.v !== 'undefined' && t.v !== 'null' })
          ;(state.c2cs || []).forEach(function (c) {
            var cid = String((c && (c.id || c.peerId || c.openid)) || '')
            if (!cid || cid === 'undefined' || cid === 'null') return
            cTargets.push({ v: 'c2c:' + cid, n: (c.name || ('私聊 ' + cid.slice(0, 8))) + '（私聊）', kind: 'c2c' })
          })
          var cq = String(state.cardQ || '').toLowerCase()
          if (cq) cTargets = cTargets.filter(function (t) { return (t.n + ' ' + t.v).toLowerCase().indexOf(cq) >= 0 })
          if (!state.cardGid && cTargets.length) state.cardGid = cTargets[0].v   // 默认选中第一项, 避免"未选目标"
          body += '<div class="dk-row" style="gap:6px;margin:2px 0">目标: <select class="qqs-sel" id="dk-card-gid" style="flex:1;min-width:0">'
          body += cTargets.map(function (t) { return '<option value="' + esc(t.v) + '"' + (t.v === state.cardGid ? ' selected' : '') + '>' + esc(t.n) + '</option>' }).join('')
            || '<option value="">(无可选目标)</option>'
          body += '</select>'
            + '<input class="qqs-txt" id="dk-card-q" placeholder="🔍 搜群/私聊…" value="' + esc(state.cardQ || '') + '" style="width:120px;font-size:12px;padding:3px 6px">'
            + '</div>'
          body += '<div style="display:flex;gap:6px;margin:2px 0">'
            + '<textarea id="dk-card-md" placeholder="# 标题&#10;&#10;正文 **加粗**&#10;&#10;![图 #208px #160px](https://example.com/img.png)" style="flex:1;min-height:140px;font-size:12px;font-family:monospace;box-sizing:border-box;padding:6px;border:1px solid #ddd;border-radius:6px;resize:vertical">' + esc(state.cardMd) + '</textarea>'
            + '<div id="dk-card-preview" style="flex:1;min-height:140px;max-height:200px;overflow:auto;border:1px dashed #c9d8ff;border-radius:6px;padding:6px;font-size:12px;background:#fafbff;box-sizing:border-box"></div>'
            + '</div>'
          body += '<div class="dk-row" style="gap:6px;margin:2px 0 0"><span style="font-size:12px;color:#888;flex:none">按钮:</span>'
            + '<textarea id="dk-card-btns" placeholder="每行一个: 文字|内容|类型&#10;先回文本: ✅ 签到|✅ 签到成功 +1 🎉&#10;执行命令: 查天气|/weather|cmd&#10;跳转链接: 🔗官网|https://qq.com|url" style="flex:1;min-height:72px;font-size:12px;font-family:monospace;box-sizing:border-box;padding:6px;border:1px solid #ddd;border-radius:6px;resize:vertical">' + esc(state.cardBtns) + '</textarea></div>'
          // 常显格式说明(2026-09-10 主人要求: 文本怎么写按钮要有说明; 三型动作 2026-09-10 晚扩充)
          body += '<div class="dk-msg" style="font-size:11px;line-height:1.6;color:#666;background:#f8f6ff;border:1px solid #eee7ff;border-radius:6px;padding:4px 8px;margin:2px 0">'
            + '<b>按钮写法</b>(上面框里一行一个, 竖线 <code>|</code> 分隔, 第三段可省):<br>'
            + '· <b>回文本</b> — <code>文字|要回的文本</code>　例: <code>✅ 签到|✅ 签到成功 +1 🎉</code>(点击后机器人直接回这句, 不吵 AI)<br>'
            + '· <b>执行命令</b> — <code>文字|/指令</code>　例: <code>查天气|/weather</code>(点击后执行该斜杠命令)<br>'
            + '· <b>跳转链接</b> — <code>文字|网址</code>　例: <code>🔗官网|https://qq.com</code>(点击直接跳网页)<br>'
            + '· 想写死类型就加第三段: <code>|text</code>(回文本) / <code>|cmd</code>(命令) / <code>|url</code>(跳转)<br>'
            + '· 每行一个按钮, 最多 25 个(5行×5列, 由"每行按钮"控制布局)</div>'
          body += '<div class="dk-row" style="gap:8px">'
            + '<button class="dk-btn ok" id="dk-card-send"' + (state.cardBusy ? ' disabled' : '') + '>🚀 发送卡片</button>'
            + '<button class="dk-btn" id="dk-card-save"' + (state.cardBusy ? ' disabled' : '') + '>💾 存为事件</button>'
            + '<button class="dk-btn" id="dk-card-broadcast"' + (state.cardBusy ? ' disabled' : '') + ' title="群发到「🎯 选目标」里勾选的全部目标(二次确认)">📤 群发到勾选目标(' + rosterSelN() + ')</button>'
            + '<span class="dk-msg" style="flex:1;text-align:right;font-size:11px;color:#888">最多 25 按钮(5行×5列)</span></div>'
          body += '<div class="dk-msg" id="dk-card-hint" style="color:#2f9e44;margin:2px 0"></div>'
        } else if (state.tab === 'bp') {
          body += sendSubTabs()
          body += '<div class="dk-row" style="font-weight:700;font-size:13px;margin:4px 0 2px">🎮 互动事件装配器(/botplay 触发)</div>'
          body += '<div class="dk-row"><span class="dk-msg" style="flex:1">定义事件与按钮 → 保存即热更 → QQ 里发 <b>/botplay 事件名</b> 发卡。点击按钮走 bot 行为(回文本等)并可选影响 AI。</span></div>'
          // 事件列表
          body += '<div class="dk-list" id="dk-bp-list" style="max-height:16vh">'
          if (!state.bpEvents.length) body += '<div class="dk-empty">还没有事件。点「➕ 新建事件」开始装配。</div>'
          state.bpEvents.forEach(function (ev, i) {
            var sel = state.bpSel === i
            var btnN = (ev.buttons || []).length
            var rowc = bpRowCount(ev)
            var overL = rowc.rows > 5
            body += '<div class="dk-item" style="cursor:pointer;background:' + (sel ? '#f1ecff' : 'transparent') + '" data-bpidx="' + i + '">'
              + '<span style="flex:1"><b>' + esc(ev.name || '(未命名)') + '</b> <span style="color:#888;font-size:11px">/ ' + esc(ev.id || '?') + ' · ' + btnN + ' 按钮·每行' + rowc.per + ' → ' + rowc.rows + '行' + (overL ? ' <b style="color:#e03131">⚠超限</b>' : '') + ' · ' + (ev.perm && ev.perm.type ? esc(ev.perm.type) : 'all') + ' · ' + (ev.expireSec || 600) + 's</span></span>'
              + '<button class="dk-btn" data-bp2card="' + i + '" title="把此事件的卡片预设(正文+按钮)复制进「📝 卡片」编辑器">📋</button>'
              + '<button class="dk-btn no" data-bpdel="' + i + '">🗑</button></div>'
          })
          body += '</div>'
          body += '<div class="dk-row"><button class="dk-btn ok" id="dk-bp-new">➕ 新建事件</button>'
          body += '<button class="dk-btn ok" id="dk-bp-save">💾 保存全部(live 热更)</button>'
          body += '<span class="dk-msg" id="dk-bp-hint" style="color:#2f9e44"></span></div>'
          // 编辑器
          if (state.bpDraft) {
            var D = state.bpDraft
            body += '<div style="border-top:1px dashed #e2d9ff;margin-top:8px;padding-top:8px">'
            body += '<div class="dk-row"><label style="font-size:12px;color:#555;width:56px">事件名</label><input class="qqs-txt" id="dk-bp-name" value="' + esc(D.name) + '" style="flex:1" placeholder="如: 签到"></div>'
            body += '<div class="dk-row"><label style="font-size:12px;color:#555;width:56px">id</label><input class="qqs-txt" id="dk-bp-id" value="' + esc(D.id) + '" style="flex:1" placeholder="英文/数字/_- (触发用)"></div>'
            body += '<div class="dk-row" style="align-items:flex-start"><label style="font-size:12px;color:#555;width:56px;padding-top:4px">卡片正文</label>'
              + '<textarea id="dk-bp-content" placeholder="markdown 模板(可嵌网络图 ![text #宽px #高px](url)); 留空=默认模板(## 🎮 事件名 + 引导)。支持 {name} 占位。" style="flex:1;min-height:64px;font-size:12px;font-family:monospace;box-sizing:border-box;padding:6px;border:1px solid #ddd;border-radius:6px;resize:vertical">' + esc(D.contentText || '') + '</textarea></div>'
            body += '<div class="dk-row"><label style="font-size:12px;color:#555;width:56px">权限</label>'
              + '<select class="qqs-sel" id="dk-bp-perm">' + ['all','triggerer','owner','users'].map(function (p) { return '<option value="' + p + '"' + (D.perm && D.perm.type === p ? ' selected' : '') + '>' + ({ all: '所有人', triggerer: '仅触发者本人(推荐)', owner: '主人白名单', users: '指定openid' }[p]) + '</option>' }).join('') + '</select>'
              + (D.perm && D.perm.type === 'users'
                ? '<input class="qqs-txt" id="dk-bp-users" value="' + esc(((D.perm.userIds) || []).join(', ')) + '" placeholder="指定 openid(逗号分隔)" style="flex:1;min-width:160px">'
                : '')
              + '<label style="font-size:12px;color:#555">有效期(s)</label><input class="qqs-txt" id="dk-bp-expire" type="number" min="30" value="' + (D.expireSec || 600) + '" style="width:70px">'
              + '<label style="font-size:12px;color:#555">总次数(0不限)</label><input class="qqs-txt" id="dk-bp-max" type="number" min="0" value="' + (D.maxClicks || 0) + '" style="width:60px">'
              + '<label style="font-size:12px;color:#555">每行按钮</label><input class="qqs-txt" id="dk-bp-perrow" type="number" min="1" max="5" value="' + (D.buttonsPerRow || 1) + '" style="width:50px" title="每行几个按钮(1~5); QQ 键盘≤5行×每行≤5, 行数=按钮数÷每行"></div>'
            var rowc2 = bpRowCount(D)
            body += '<div style="font-weight:700;font-size:12px;margin:6px 0 2px;color:#4a3a9f">按钮 <span id="dk-bp-layout" style="font-weight:400;color:' + (rowc2.rows > 5 ? '#e03131' : '#2f9e44') + '">共 ' + rowc2.n + ' 个 · 每行 ' + rowc2.per + ' 个 → ' + rowc2.rows + ' 行' + (rowc2.rows > 5 ? '(超 QQ 上限 5 行, 发卡会报错!)' : '(≤5 行 ✅)') + '</span></div>'
            ;(D.buttons || []).forEach(function (b, bi) {
              var bt = (b.botAction && b.botAction.type) || 'reply_text'
              var md = (b.llmEffect && b.llmEffect.mode) || 'no_append'
              var ctx = (b.llmEffect && b.llmEffect.contextText) || ''
              // 视觉隔离: 每加一个按钮, 与上一个之间加一条虚线 + 按钮序号, 一眼分清几组配置
              body += '<div style="font-size:11px;color:#8b7cc7;margin:' + (bi > 0 ? '6px 0 0' : '2px 0 0') + '">── 按钮 ' + (bi + 1) + '</div>'
              body += '<div class="dk-item" style="border:1px solid #f0ecff;border-radius:8px;margin:1px 0;padding:4px 6px">'
                + '<input class="qqs-txt" data-bplabel="' + bi + '" value="' + esc(b.label) + '" placeholder="按钮文字" style="flex:1;min-width:90px">'
                + '<select class="qqs-sel" data-bpact="' + bi + '">' + ['reply_text','jump_url','callback','command'].map(function (t) { return '<option value="' + t + '"' + (bt === t ? ' selected' : '') + '>' + ({ reply_text: '回文本', jump_url: '跳链接', callback: '仅结算', command: '执行命令' }[t]) + '</option>' }).join('') + '</select>'
                + '<select class="qqs-sel" data-bpmode="' + bi + '">' + ['no_append','append_silent','append_wake'].map(function (m) { return '<option value="' + m + '"' + (md === m ? ' selected' : '') + '>' + ({ no_append: '不影响AI', append_silent: '记录不唤醒', append_wake: '记录并唤醒AI' }[m]) + '</option>' }).join('') + '</select>'
                + '<button class="dk-btn no" data-bpdelbtn="' + bi + '">✕</button></div>'
                // 动作参数行: 按类型给出对应输入(jump_url → 链接 URL; command → 命令名; 其余 → 回复文本)
                + (bt === 'jump_url'
                  ? '<input class="qqs-txt" data-bpurl="' + bi + '" value="' + esc((b.botAction && b.botAction.url) || '') + '" placeholder="🔗 链接地址, 如 https://www.baidu.com(QQ 点按钮直接跳转)" style="width:calc(100% - 8px);box-sizing:border-box;margin:0 0 4px 4px">'
                  : '<input class="qqs-txt" data-bpacttext="' + bi + '" value="' + esc((b.botAction && b.botAction.text) || '') + '" placeholder="' + ({ reply_text: '点按钮后 bot 回复的内容', command: '执行的命令名(如 bot-status, 不带/)', callback: '(仅结算, 无需文本)' }[bt] || '') + '" style="width:calc(100% - 8px);box-sizing:border-box;margin:0 0 4px 4px">')
                + '<input class="qqs-txt" data-bpctx="' + bi + '" value="' + esc(ctx) + '" placeholder="(记录/唤醒AI时)对AI说的话, 支持 {name} 事件名 {label} 按钮名; 空=默认" style="width:calc(100% - 8px);box-sizing:border-box;margin:0 0 2px 4px">'
            })
            body += '<div class="dk-row"><button class="dk-btn" id="dk-bp-addbtn">➕ 加按钮</button>'
              + '<span class="dk-msg" id="dk-bp-addmsg">每行 ' + rowc2.per + ' 个 × 最多 5 行 = 上限 ' + (rowc2.per * 5) + ' 个(QQ 键盘: ≤5行 × 每行≤5)</span></div>'
            body += '</div>'
          }
        }
        body += status
        body += '<div class="dk-row" style="border-top:1px solid #f0ecff;padding-top:8px;margin-top:8px"><span class="dk-msg">登记群(官方无群列表,手动粘贴):</span>'
          + '<input class="qqs-txt" id="dk-bindgid" placeholder="group_openid" value="' + esc(state.bindGid) + '" style="width:200px">'
          + '<input class="qqs-txt" id="dk-bindname" placeholder="备注(可选)" value="' + esc(state.bindName) + '" style="width:110px">'
          + '<button class="dk-btn" id="dk-bind">绑定</button></div>'
        b.innerHTML = body
        bindBodyEvents()
        bindPanelDrag()
        if (state.tab === 'send') applyTargetFilter(panel, state)
        if (state.tab === 'chat') renderChatList()
        if (state.tab === 'join') renderJoinList()
        if (state.tab === 'mute') { renderMemberList(); renderMuteList() }
        if (state.tab === 'roster' || state.tab === 'send') { renderRosterList(); bindRosterEvents(); loadHubState(); loadBroadcastTasks(false, true) }
        // 📝 卡片: 必须在 paintBody 内绑定(2026-09-10 修复: 原在 tab 点击处先 bind 后 paintBody,
        // 绑的是即将被替换的旧 DOM → 发送/存为事件无反应、预览不渲染)
        if (state.tab === 'card') bindCardEvents()
        if (state.tab === 'session') bindLocalModel()   // ⚠️ 只绑定: 加载由切 tab 时触发(防重绘循环)
        // 📤 广播子页: 绑定群发按钮 + 刷新任务列表(任务列表静默拉取, 不重绘 → 防死循环)
        if (state.tab === 'broadcast') { bindBroadcastEvents(); loadBroadcastTasks(false, true); startBroadcastAdvance() }
        // 分组(host 持久化, 与 AI 共用): 进选目标/广播页时拉一次, 保证多浏览器与 AI 侧看到的是同一份
        if (state.tab === 'roster' || state.tab === 'broadcast') loadTgGroupsFromHost()
        // 注: 📤 群发子标签栏的点击绑定由上面 bindBodyEvents() 统一处理(它含 [data-subtab])
        // 首次进入聊天 tab 自动拉最新一页
        if (state.tab === 'chat' && !state.chatItems.length && !state.chatBusy) loadChat(true)
        setTimeout(layoutPanel, 0)
      }
      function bindBodyEvents() {
        var tbs = panel.querySelectorAll('.dk-tab button')
        tbs.forEach(function (btn) {
          btn.onclick = function () {
            state.tab = btn.getAttribute('data-t'); state.msg = ''
            if (state.tab === 'join') loadJoins(); else if (state.tab === 'mute') loadMutes()
            else if (state.tab === 'out') loadOutMode()
            else if (state.tab === 'session') { loadLocalModel(); bindLocalModel() }
            else if (state.tab === 'bp') loadBotplay()
            else if (state.tab === 'chat') { state.chatItems = []; state.chatErr = ''; }
            paintBody()
          }
        })
        // 📤 群发 · 次级标签切换(2026-09-10)
        panel.querySelectorAll('[data-subtab]').forEach(function (sb) {
          sb.onclick = function () {
            var v = sb.getAttribute('data-subtab')
            state.tab = v; state.msg = ''
            if (v === 'bp') loadBotplay()
            paintBody()
          }
        })
        var gsel = panel.querySelector('#dk-gid')
        if (gsel) gsel.onchange = function (e) {
          state.gid = e.target.value; state.msg = ''
          if (state.tab === 'join') loadJoins(); else if (state.tab === 'mute') loadMutes()
          else if (state.tab === 'chat') { state.chatItems = []; state.chatErr = ''; state.chatBusy = ''; paintBody(); loadChat(true) }
          else paintBody()
        }
        var rads = panel.querySelectorAll('input[name="dk-scope"]')
        rads.forEach(function (r) {
          r.onchange = function () {
            state.sendScope = r.value; state.msg = ''
            if (r.value !== 'c2c') state.sendTo = ''
            if (state.tab === 'chat') { state.chatItems = []; state.chatErr = ''; state.chatBusy = ''; paintBody(); loadChat(true) }
            else paintBody()
          }
        })
        var c2c = panel.querySelector('#dk-c2c')
        if (c2c) c2c.onchange = function (e) {
          state.sendTo = e.target.value; state.msg = ''
          if (state.tab === 'chat') { state.chatItems = []; state.chatErr = ''; state.chatBusy = ''; paintBody(); loadChat(true) }
          else paintBody()
        }
        var srch = panel.querySelector('#dk-target-search')
        if (srch) srch.oninput = function (e) { state.targetQ = e.target.value; applyTargetFilter(panel, state) }
        var txt = panel.querySelector('#dk-text')
        if (txt) { txt.oninput = function (e) { state.sendText = e.target.value; var n = panel.querySelector('.dk-msg'); if (n) n.textContent = '已输 ' + state.sendText.length + '/2000' } }
        var ins = panel.querySelector('#dk-insctx')
        if (ins) { ins.onchange = function (e) { state.insertCtx = !!e.target.checked } }
        var omrad = panel.querySelectorAll('input[name="dk-outmode"]')
        if (omrad) omrad.forEach(function (r2) { r2.onchange = function () { saveOutMode(r2.value) } })
        var snd = panel.querySelector('#dk-send')
        if (snd) snd.onclick = sendNow
        var rj = panel.querySelector('#dk-refresh-join')
        if (rj) rj.onclick = loadJoins
        var rm = panel.querySelector('#dk-refresh-mute')
        if (rm) rm.onclick = loadMutes
        var crf = panel.querySelector('#dk-chat-refresh')
        if (crf) crf.onclick = function () { state.chatItems = []; state.chatErr = ''; state.chatBusy = ''; loadChat(true) }
        var cbox = panel.querySelector('#dk-chat-box')
        if (cbox) cbox.onscroll = function () {
          if (state.tab !== 'chat' || !state.chatMore || state.chatBusy) return
          if (cbox.scrollTop <= 4) loadChat(false) // 顶部 → 加载更早
        }
        var cinput = panel.querySelector('#dk-chat-input')
        if (cinput) {
          cinput.oninput = function (e) {
            state.chatText = e.target.value
            var n = panel.querySelector('#dk-chat-cnt'); if (n) n.textContent = state.chatText.length + '/2000'
            if (state.sendScope !== 'c2c') chatAtScan() // 输入 @ 弹成员候选
          }
          cinput.onkeydown = function (e) {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              if (atM.open) {
                e.preventDefault()
                var lst = chatAtList()
                if (lst.length) { atM.idx = (atM.idx + (e.key === 'ArrowDown' ? 1 : -1) + lst.length) % lst.length; chatAtRender() }
              }
              return
            }
            if (e.key === 'Enter') {
              if (atM.open) {
                var l2 = chatAtList()
                if (l2.length) { e.preventDefault(); chatAtPick(l2[atM.idx >= l2.length ? 0 : atM.idx].mid); return }
              }
              if (!e.shiftKey) { e.preventDefault(); chatSend('auto') }
              return
            }
            if (e.key === 'Escape' && atM.open) { chatAtClose(); return }
          }
          // 粘贴/拖拽图片 → 自动转 [MEDIA:kind|来源] 追加进文本框(有本机路径直用, 否则小文件上传到 dock-uploads)
          cinput.onpaste = function (e) {
            var files = (e.clipboardData && e.clipboardData.files) ? Array.from(e.clipboardData.files) : []
            // 截图/复制位图时 clipboardData.files 常为空 → 从 items 里捞图片
            if (!files.length && e.clipboardData && e.clipboardData.items) {
              for (var i = 0; i < e.clipboardData.items.length; i++) {
                var it = e.clipboardData.items[i]
                if (it.kind === 'file' || String(it.type).indexOf('image/') === 0) {
                  var f = (it.getAsFile && it.getAsFile()) || null
                  if (f) files.push(f)
                }
              }
            }
            if (files.length) { e.preventDefault(); chatIngestFiles(files) }
          }
          cinput.addEventListener('dragover', function (e) { e.preventDefault() })
          cinput.ondrop = function (e) {
            e.preventDefault()
            var files = (e.dataTransfer && e.dataTransfer.files) ? Array.from(e.dataTransfer.files) : []
            if (files.length) chatIngestFiles(files)
          }
        }
        // 群聊目标: 预热 @ 成员表(输入 @ 时已缓存)
        if (state.sendScope !== 'c2c' && state.gid) chatLoadAtMembers()
        else chatAtClose()
        var cins = panel.querySelector('#dk-chat-ins')
        if (cins) cins.onclick = function () { state.chatIns = !state.chatIns; cins.textContent = '🧠 ' + (state.chatIns ? '记入上下文' : '不记上下文') }
        var csend = panel.querySelector('#dk-chat-send')
        if (csend) csend.onclick = function () { chatSend('auto') }
        var fadd = panel.querySelector('#dk-chat-add-file')
        var fpick = panel.querySelector('#dk-chat-file')
        if (fadd && fpick) fadd.onclick = function () { fpick.value = ''; fpick.click() }
        if (fpick) fpick.onchange = function () { var files = Array.from(fpick.files || []); if (files.length) chatIngestFiles(files, true) }
        var iadd = panel.querySelector('#dk-chat-add-img')
        if (iadd) iadd.onclick = function () {
          // 弹小窗输入本机路径或网络图片 → 插入 [MEDIA:image|src](追加, 不清空已有文本)
          var src = window.prompt('输入图片来源: 本机绝对路径(D:\\xxx\\a.jpg) 或 http(s) 图片地址', '')
          if (src === null) return
          src = String(src || '').trim()
          if (!src) return
          chatInsertMedia('image', src)
        }
        var bd = panel.querySelector('#dk-bind')
        if (bd) bd.onclick = function () { state.bindGid = (panel.querySelector('#dk-bindgid') || {}).value || ''; state.bindName = (panel.querySelector('#dk-bindname') || {}).value || ''; doBind() }
        // ── 🎮 互动事件装配器: 列表选择/删除/新建/保存/编辑器字段 ──
        var bpList = panel.querySelector('#dk-bp-list')
        if (bpList) bpList.querySelectorAll('[data-bpidx]').forEach(function (it) {
          it.onclick = function () {
            var idx = Number(it.getAttribute('data-bpidx'))
            state.bpSel = idx
            state.bpDraft = JSON.parse(JSON.stringify(state.bpEvents[idx] || {}))
            paintBody()
          }
        })
        bpList && bpList.querySelectorAll('[data-bpdel]').forEach(function (b) {
          b.onclick = function (e) {
            e.stopPropagation()
            var idx = Number(b.getAttribute('data-bpdel'))
            state.bpEvents.splice(idx, 1)
            if (state.bpSel === idx) { state.bpSel = null; state.bpDraft = null }
            else if (state.bpSel !== null && state.bpSel > idx) state.bpSel -= 1
            paintBody()
          }
        })
        // 📋 事件 → 卡片编辑器(2026-09-10 主人要求): 把事件的正文预设+按钮复制进「📝 卡片」, 便于改完再发
        bpList && bpList.querySelectorAll('[data-bp2card]').forEach(function (b) {
          b.onclick = function (e) {
            e.stopPropagation()
            var idx = Number(b.getAttribute('data-bp2card'))
            var ev = state.bpEvents[idx]
            if (!ev) return
            // 正文: 事件自定义 contentText; 空则用事件默认模板
            state.cardMd = (ev.contentText && String(ev.contentText).trim())
              ? String(ev.contentText)
              : ('## 🎮 ' + (ev.name || '互动事件') + '\n\n点下方按钮完成互动 👇')
            // 按钮 → 卡片编辑器的文本格式(**显式带类型后缀**, 三种动作都能无损搬过来):
            //   jump_url → 文字|网址|url　command → 文字|指令|cmd　reply_text → 文字|文本|text
            state.cardBtns = (ev.buttons || []).map(function (bb) {
              var act = (bb && bb.botAction) || {}
              var label = (bb && bb.label) || '按钮'
              if (act.type === 'jump_url') return label + '|' + String(act.url || '') + '|url'
              if (act.type === 'command') return label + '|' + String(act.text || '').replace(/^\//, '') + '|cmd'
              return label + '|' + String(act.text || '') + '|text'
            }).join('\n')
            state.tab = 'card'
            paintBody()
            setTimeout(function () {
              var h = panel.querySelector('#dk-card-hint')
              if (h) h.textContent = '📋 已从事件「' + (ev.name || '') + '」载入预设(正文 ' + state.cardMd.length + ' 字 / 按钮 ' + (ev.buttons || []).length + ' 个) — 可直接发送, 也可改完再发'
            }, 0)
          }
        })
        var bpNew = panel.querySelector('#dk-bp-new')
        if (bpNew) bpNew.onclick = function () {
          state.bpSel = null
          state.bpDraft = { id: '', name: '', contentText: '', maxClicks: 0, expireSec: 600, buttonsPerRow: 1, perm: { type: 'all', userIds: [] }, buttons: [{ id: 'b1', label: '按钮', botAction: { type: 'reply_text', text: '' }, llmEffect: { mode: 'no_append', contextText: '' } }] }
          paintBody()
        }
        // 编辑器字段(名称/id/有效期/总次数/权限)
        var bpName = panel.querySelector('#dk-bp-name')
        if (bpName) bpName.oninput = function (e) { state.bpDraft.name = e.target.value }
        var bpId = panel.querySelector('#dk-bp-id')
        if (bpId) bpId.oninput = function (e) { state.bpDraft.id = e.target.value.trim() }
        var bpContent = panel.querySelector('#dk-bp-content')
        if (bpContent) bpContent.oninput = function (e) { state.bpDraft.contentText = e.target.value }
        var bpPerm = panel.querySelector('#dk-bp-perm')
        if (bpPerm) bpPerm.onchange = function (e) {
          state.bpDraft.perm = state.bpDraft.perm || {}
          state.bpDraft.perm.type = e.target.value
          paintBody() // users 档要显示 openid 输入框
        }
        var bpUsers = panel.querySelector('#dk-bp-users')
        if (bpUsers) bpUsers.oninput = function (e) {
          state.bpDraft.perm = state.bpDraft.perm || {}
          state.bpDraft.perm.userIds = String(e.target.value || '').split(/[,，\s]+/).map(function (s) { return s.trim() }).filter(Boolean)
        }
        var bpExpire = panel.querySelector('#dk-bp-expire')
        if (bpExpire) bpExpire.oninput = function (e) { state.bpDraft.expireSec = Math.max(30, Number(e.target.value) || 600) }
        var bpMax = panel.querySelector('#dk-bp-max')
        if (bpMax) bpMax.oninput = function (e) { state.bpDraft.maxClicks = Math.max(0, Number(e.target.value) || 0) }
        var bpPerRow = panel.querySelector('#dk-bp-perrow')
        if (bpPerRow) bpPerRow.oninput = function (e) { state.bpDraft.buttonsPerRow = Math.max(1, Math.min(5, Math.round(Number(e.target.value)) || 1)); bpLayoutHint() }
        // 按钮行编辑(label/botAction.type/llmEffect.mode/删除/回复文本/对AI说的话)
        var bpBtns = panel.querySelectorAll('[data-bplabel]')
        bpBtns.forEach(function (inp) {
          var bi = Number(inp.getAttribute('data-bplabel'))
          inp.oninput = function (e) {
            state.bpDraft.buttons[bi].label = e.target.value
            if (!state.bpDraft.buttons[bi].id) state.bpDraft.buttons[bi].id = 'b' + (bi + 1)
          }
        })
        var bpActs = panel.querySelectorAll('[data-bpact]')
        bpActs.forEach(function (sel) {
          var bi = Number(sel.getAttribute('data-bpact'))
          sel.onchange = function (e) {
            state.bpDraft.buttons[bi].botAction = state.bpDraft.buttons[bi].botAction || {}
            state.bpDraft.buttons[bi].botAction.type = e.target.value
          }
        })
        var bpModes = panel.querySelectorAll('[data-bpmode]')
        bpModes.forEach(function (sel) {
          var bi = Number(sel.getAttribute('data-bpmode'))
          sel.onchange = function (e) {
            state.bpDraft.buttons[bi].llmEffect = state.bpDraft.buttons[bi].llmEffect || {}
            state.bpDraft.buttons[bi].llmEffect.mode = e.target.value
          }
        })
        var bpTexts = panel.querySelectorAll('[data-bpacttext]')
        bpTexts.forEach(function (inp) {
          var bi = Number(inp.getAttribute('data-bpacttext'))
          inp.oninput = function (e) {
            state.bpDraft.buttons[bi].botAction = state.bpDraft.buttons[bi].botAction || {}
            state.bpDraft.buttons[bi].botAction.text = e.target.value
          }
        })
        // 跳链接按钮的 URL 输入
        var bpUrls = panel.querySelectorAll('[data-bpurl]')
        bpUrls.forEach(function (inp) {
          var bi = Number(inp.getAttribute('data-bpurl'))
          inp.oninput = function (e) {
            state.bpDraft.buttons[bi].botAction = state.bpDraft.buttons[bi].botAction || {}
            state.bpDraft.buttons[bi].botAction.url = e.target.value
          }
        })
        var bpCtxs = panel.querySelectorAll('[data-bpctx]')
        bpCtxs.forEach(function (inp) {
          var bi = Number(inp.getAttribute('data-bpctx'))
          inp.oninput = function (e) {
            state.bpDraft.buttons[bi].llmEffect = state.bpDraft.buttons[bi].llmEffect || {}
            state.bpDraft.buttons[bi].llmEffect.contextText = e.target.value
          }
        })
        var bpDelBtn = panel.querySelectorAll('[data-bpdelbtn]')
        bpDelBtn.forEach(function (b) {
          b.onclick = function () {
            state.bpDraft.buttons.splice(Number(b.getAttribute('data-bpdelbtn')), 1)
            paintBody()
          }
        })
        var bpAddBtn = panel.querySelector('#dk-bp-addbtn')
        if (bpAddBtn) bpAddBtn.onclick = function () {
          var cap = Math.max(1, Math.min(5, Math.round(Number(state.bpDraft.buttonsPerRow)) || 1)) * 5
          if (state.bpDraft.buttons.length >= cap) return
          state.bpDraft.buttons.push({ id: 'b' + (state.bpDraft.buttons.length + 1), label: '按钮', botAction: { type: 'reply_text', text: '' }, llmEffect: { mode: 'no_append', contextText: '' } })
          paintBody()
        }
        var bpSave = panel.querySelector('#dk-bp-save')
        if (bpSave) bpSave.onclick = saveBotplay
      }
      // QQ 键盘布局限制(官方 API): 键盘最多 5 行 × 每行最多 5 个按钮 → 行数=ceil(按钮数/每行数)≤5 才合法
      function bpRowCount(ev) {
        var per = Math.max(1, Math.min(5, Math.round(Number(ev.buttonsPerRow)) || 1))
        var n = (ev.buttons || []).length
        return { n: n, per: per, rows: Math.ceil(n / per) }
      }
      // 编辑器内实时刷新布局提示(改「每行按钮」时调用, 不重建 DOM 保输入焦点)
      function bpLayoutHint() {
        if (!state.bpDraft || !panel) return
        var el = panel.querySelector('#dk-bp-layout')
        if (!el) return
        var c = bpRowCount(state.bpDraft)
        var over = c.rows > 5
        el.textContent = '共 ' + c.n + ' 个 · 每行 ' + c.per + ' 个 → ' + c.rows + ' 行' + (over ? '(超 QQ 上限 5 行, 发卡会报错!)' : '(≤5 行 ✅)')
        el.style.color = over ? '#e03131' : '#2f9e44'
      }
      // 🎮 互动事件装配器: 读/存走独立文件路由(2026-09-10 M4.3: {dataRoot}/.qqbot/botplay-events.json)
      function loadBotplay() {
        if (state.tab !== 'bp') return
        api('group/botplay-events', state.ns ? 'ns=' + encodeURIComponent(state.ns) : '')
          .then(function (d) {
            if (d && d.ok && Array.isArray(d.events)) {
              state.bpEvents = JSON.parse(JSON.stringify(d.events))
              if (!state.bpDraft && state.bpEvents.length) { state.bpSel = 0; state.bpDraft = JSON.parse(JSON.stringify(state.bpEvents[0])) }
              else if (!state.bpEvents.length) { state.bpSel = null; state.bpDraft = null }
              paintBody()
            }
          }).catch(function () {})
      }
      function saveBotplay() {
        var hint = panel.querySelector('#dk-bp-hint')
        var ok = function (v) { if (hint) hint.textContent = v }
        // 草稿回写进列表(存在编辑中草稿时)
        if (state.bpDraft) {
          var draft = state.bpDraft
          if (!draft.id || !/^[A-Za-z0-9_-]+$/.test(draft.id)) { ok('⚠️ id 必填且只能 字母/数字/_/-'); return }
          if (!draft.name || !draft.name.trim()) { ok('⚠️ 事件名必填'); return }
          if (!Array.isArray(draft.buttons) || !draft.buttons.length) { ok('⚠️ 至少 1 个按钮'); return }
          var dupId = false
          state.bpEvents.forEach(function (ev, i) { if (ev.id === draft.id && i !== state.bpSel) dupId = true })
          if (dupId) { ok('⚠️ 事件 id 重复: ' + draft.id); return }
          var draftRow = bpRowCount(draft)
          if (draftRow.rows > 5) { ok('⚠️ 「' + draft.name + '」按钮布局超限: ' + draftRow.n + ' 个按钮 × 每行 ' + draftRow.per + ' 个 = ' + draftRow.rows + ' 行(QQ 键盘最多 5 行)'); return }
          if (state.bpSel !== null && state.bpEvents[state.bpSel]) state.bpEvents[state.bpSel] = JSON.parse(JSON.stringify(draft))
          else { state.bpEvents.push(JSON.parse(JSON.stringify(draft))); state.bpSel = state.bpEvents.length - 1 }
        }
        var badEv = null
        state.bpEvents.forEach(function (ev) { var c = bpRowCount(ev); if (c.rows > 5 && !badEv) badEv = { name: ev.name, per: c.per, rows: c.rows } })
        if (badEv) { ok('⚠️ 事件「' + badEv.name + '」每行 ' + badEv.per + ' 个 → ' + badEv.rows + ' 行, 超 QQ 5 行上限, 未保存'); return }
        if (hint) hint.textContent = '保存中…'
        apiPost('group/botplay-events', { ns: state.ns || 'im-qqbot', events: state.bpEvents }).then(function (d) {
          if (d && d.ok) { if (hint) hint.textContent = '✅ 已保存(共 ' + state.bpEvents.length + ' 个事件, live 热更已生效)' }
          else { if (hint) hint.textContent = '保存失败: ' + ((d && (d.error || d.msg)) || '未知错误') }
        }).catch(function () { if (hint) hint.textContent = '保存异常' })
      }
      // ── 💬 聊天视图: 数据拉取 / QQ 风格气泡渲染 / 顶部滚动分页 ──
      function chatPeerReady() {
        return state.sendScope === 'c2c' ? !!state.sendTo : !!state.gid
      }
      function chatPeerName() {
        return state.sendScope === 'c2c'
          ? ('私聊「' + (c2cSelName()) + '」')
          : ('群「' + (groupSelName()) + '」')
      }
      // 剥 Markdown 语法(移植自 gal-view transcript.mjs, 保留正文)让气泡像 QQ 纯文本
      function mdPlain(t) {
        if (typeof t !== 'string') return ''
        return t
          .replace(/^```[^\n]*$/gm, '')
          .replace(/!\[[^\]\n]*\]\([^)\n]*\)/g, '')
          .replace(/\[([^\]\n]+)\]\([^)\n]*\)/g, '$1')
          .replace(/\*\*([^*\n]+)\*\*/g, '$1')
          .replace(/~~([^~\n]+)~~/g, '$1')
          .replace(/(^|[^*\w])\*([^*\n]+?)\*(?!\*)(?![*\w])/g, '$1$2')
          .replace(/`([^`\n]+)`/g, '$1')
          .replace(/^#{1,6}[ \t]+/gm, '')
          .replace(/^>[ \t]?/gm, '')
          .replace(/^[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*$/gm, '')
          .replace(/^[-*+][ \t]+/gm, '')
          .replace(/^\d+\.[ \t]+/gm, '')
          .replace(/\r\n?/g, '\n')
          .replace(/\n{3,}/g, '\n\n')
          .trim()
      }
      function chatTime(ts) {
        if (!ts) return ''
        var d = new Date(ts)
        if (isNaN(d.getTime())) return ''
        var p2 = function (n) { return String(n).padStart(2, '0') }
        var hm = p2(d.getHours()) + ':' + p2(d.getMinutes())
        var now = new Date()
        if (d.toDateString() === now.toDateString()) return hm
        return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + hm
      }
      // reset=true 拉最新一页(清空重载); reset=false 用 chatOldest 加载更早并保持视口
      function loadChat(reset) {
        if (!state.ns) { renderChatList(); return }
        if (!chatPeerReady()) { state.chatItems = []; state.chatMore = false; state.chatErr = '先选一个群/私聊目标'; renderChatList(); return }
        if (state.chatBusy) return
        var mode = reset ? 'chat' : 'more'
        state.chatBusy = mode
        if (reset) { state.chatItems = []; state.chatOldest = 0 }
        var box = document.getElementById('dk-chat-box')
        var keep = 0
        if (box && mode === 'more') keep = box.scrollHeight - box.scrollTop
        renderChatList() // 立即显示加载态
        var peerId = state.sendScope === 'c2c' ? state.sendTo : state.gid
        var q = 'ns=' + encodeURIComponent(state.ns) + '&scope=' + state.sendScope + '&peerId=' + encodeURIComponent(peerId) + '&limit=50'
        if (mode === 'more' && state.chatOldest > 0) q += '&beforeSeq=' + state.chatOldest
        api('chat/history', q).then(function (d) {
          state.chatBusy = ''
          if (!d || !d.ok) { state.chatErr = (d && (d.error || d.msg)) || '加载失败'; renderChatList(); return }
          var list = (Array.isArray(d.items) ? d.items : []).filter(function (it) {
            return it && ((typeof it.text === 'string' && it.text) || (Array.isArray(it.images) && it.images.length))
          })
          if (mode === 'more') {
            var have = {}
            state.chatItems.forEach(function (x) { have[x.seq] = 1 })
            state.chatItems = list.filter(function (x) { return !have[x.seq] }).concat(state.chatItems)
          } else {
            state.chatItems = list
          }
          state.chatMore = d.hasMore === true
          state.chatErr = ''
          state.chatOldest = state.chatItems.length ? state.chatItems[0].seq : 0
          renderChatList(mode === 'more' ? keep : null)
        }).catch(function () {
          state.chatBusy = ''
          state.chatErr = '网络错误'
          renderChatList()
        })
      }
      // 文本里的 URL → 可点链接(2026-09-10 主人实测: "这个 jump_url 进不了 dock 聊天界面" ——
      // 卡片分享/ARK 里的 jump_url 在气泡里是纯文本, 点不动)。
      // ⚠️ 必须在 esc() 之后调用: 只对**已转义**的纯文本做替换, 拼进 href 的也是转义后的串 → 不开新的 XSS 面。
      function linkifyText(escaped) {
        return String(escaped || '').replace(/https?:\/\/[^\s<>"']+/g, function (u) {
          // 尾随标点不入链接(中文标点也剥), 避免把「。」「）」吃进 URL
          var trail = ''
          var m = u.match(/[.,;:!?，。；：！？、）)】」』"']+$/)
          if (m) { trail = m[0]; u = u.slice(0, u.length - trail.length) }
          if (!u) return trail
          return '<a class="dk-link" href="' + u + '" target="_blank" rel="noopener noreferrer" title="' + u + '">' + u + '</a>' + trail
        })
      }
      // ── 媒体地址归一(2026-09-13 主人要求: dock 聊天界面图片要**同时兼容 url 与本地路径/图库链接**) ──
      //   入站消息的图片已改为给**本地路径**(省 token、看图不用再下载), 浏览器直接拿 D:\… 当然加载不出来,
      //   于是统一转成同源直出 URL: /api/qqbot-settings/chat/raw-media?p=<本机路径>。
      //   http(s) / 已是 /api/... 的(含 sticker-img?id=xxx 图库链接) 一律原样。
      function chatMediaURL(u) {
        var s = String(u || '').trim()
        if (!s) return s
        if (/^(https?:|\/\/|\/api\/|data:|blob:)/i.test(s)) return s
        if (/^[A-Za-z]:[\\/]/.test(s) || /^\\\\/.test(s) || s.charAt(0) === '/') {
          return '/api/qqbot-settings/chat/raw-media?p=' + encodeURIComponent(s)
        }
        return s
      }
      // 图库兜底: 消息里记的本地路径是"当时"的(candidate→library 搬层后就失效),
      //   但文件名正是图库 id(12 位 sha1) → 加载失败时再用 sticker-img?id= 试一次(按 id 解析, 与层无关)
      function chatStickerFallback(src) {
        var s = String(src || '')
        if (s.indexOf('/chat/raw-media?p=') >= 0) {
          try { s = decodeURIComponent(s.split('p=')[1] || '') } catch (e) { /* 保持原样 */ }
        }
        var base = s.replace(/[?#].*$/, '').split(/[\\/]/).pop() || ''
        var idm = base.match(/^([0-9a-f]{12})\.([a-z0-9]{2,5})$/i)
        if (!idm) return ''
        var dd = ''
        try { dd = curDataDir() || '' } catch (e) { dd = '' }
        return '/api/qqbot-settings/sticker-img?id=' + encodeURIComponent(idm[1]) + (dd ? '&dataDir=' + encodeURIComponent(dd) : '')
      }
      function renderChatList(keepScrollOffset) {
        var box = document.getElementById('dk-chat-box')
        if (!box) return
        var st = document.getElementById('dk-chat-status')
        if (st) {
          if (state.chatBusy === 'send') st.textContent = '发送中…'
          else if (chatFlash) st.textContent = chatFlash
          else if (state.chatBusy) st.textContent = state.chatBusy === 'chat' ? '加载中…' : '加载更早…'
          else if (state.chatErr) st.textContent = state.chatErr
          else if (!state.chatItems.length) st.textContent = '暂无记录 —— 机器人和该目标聊过后会显示在这里'
          else st.textContent = '共 ' + state.chatItems.length + ' 条 · ' + chatPeerName() + (state.chatMore ? ' · 上滑加载更早' : ' · 已到最早')
        }
        if (!state.chatItems.length) {
          var emptyTxt = state.chatErr || (!chatPeerReady() ? '先选一个群/私聊目标' : '还没有聊天记录(该目标暂无活跃会话)')
          box.innerHTML = '<div class="dk-empty" style="padding:26px 0">' + esc(emptyTxt) + '</div>'
          return
        }
        var html = ''
        if (state.chatMore) html += '<div class="dk-chat-top">↑ 上滑加载更早消息</div>'
        html += state.chatItems.map(function (it) {
          var isOut = it.dir === 'out'
          var who = isOut ? '我' : (it.sender || (state.sendScope === 'c2c' ? c2cSelName() : '群友'))
          var ava = isOut ? '🐳' : chatAvaOf(who)
          var meta = '<span>' + esc(who) + '</span>'
            + (it.tag ? '<span class="dk-ctag">' + esc(it.tag) + '</span>' : '')
            + '<span>' + esc(chatTime(it.time)) + '</span>'
          var imgs = (Array.isArray(it.images) ? it.images : []).map(function (m) {
            var u = typeof m === 'string' ? m : (m && m.url)
            var k = typeof m === 'string' ? 'image' : ((m && m.kind) || 'image')
            if (!u) return ''
            u = chatMediaURL(u) // 本机路径 → 同源直出 URL(兼容 url / 本地路径 / 图库链接)
            if (k === 'file') return '<a class="dk-file" href="' + esc(u) + '" target="_blank" rel="noopener" title="' + esc(u) + '">📎 ' + esc((m && m.name) || '文件') + '</a>'
            if (k === 'voice') return '<audio class="dk-audio" controls preload="metadata" src="' + esc(u) + '"></audio>'
            if (k === 'video') return '<video class="dk-video" controls preload="metadata" src="' + esc(u) + '"></video>'
            // 兜底链(按序试): ① 后端给的 QQ 链接(台账兜底, 本地文件被清了也能显示)
            //                      ② 图库 id 链接 sticker-img?id=(路径搬层后的旧路径救不回时用)
            var fbs = []
            if (m && m.fb && String(m.fb) !== String(u)) fbs.push(String(m.fb))
            var sf = chatStickerFallback(m, u)
            if (sf && sf !== u && fbs.indexOf(sf) < 0) fbs.push(sf)
            return '<img class="dk-img" loading="lazy" data-lb="' + esc(u) + '"' + (fbs.length ? ' data-fb="' + esc(JSON.stringify(fbs)) + '"' : '') + ' src="' + esc(u) + '" referrerpolicy="no-referrer" alt="[图片]">'
          }).join('')
          var txt = it.text ? chatRenderText(it.text) : ''
          return '<div class="dk-crow ' + (isOut ? 'out' : 'in') + '">'
            + '<div class="dk-ava">' + ava + '</div>'
            + '<div class="dk-cmain">'
            + '<div class="dk-cmeta">' + meta + '</div>'
            + '<div class="dk-cbubble">' + imgs + txt + '</div>'
            + '</div>'
            + '</div>'
        }).join('')
        html += '<div class="dk-chat-bottom">—— 会话尾部 · ' + esc(chatPeerName()) + ' ——</div>'
        box.innerHTML = html
        // 图片: 单击/右键 → 灯箱放大(右键不再弹浏览器菜单, 避免误触发 onerror 变加载失败)
        box.querySelectorAll('img.dk-img').forEach(function (img) {
          var lbOf = function () { return img.getAttribute('data-lb') || img.src }
          img.onclick = function (e) { e.preventDefault(); e.stopPropagation(); openLightbox(lbOf()) }
          img.oncontextmenu = function (e) { e.preventDefault(); e.stopPropagation(); openLightbox(lbOf()) }
          // 加载失败 → 按兜底链依次重试(QQ 链接 → 图库 id 链接) ② 全都失败才灰字提示
          img.onerror = function () {
            var list = []
            try { list = JSON.parse(img.getAttribute('data-fb') || '[]') || [] } catch (e) { list = [] }
            var i = Number(img.getAttribute('data-fbi') || '0')
            if (Array.isArray(list) && i < list.length) {
              img.setAttribute('data-fbi', String(i + 1))
              img.setAttribute('data-lb', String(list[i]))
              img.src = String(list[i])
              return
            }
            img.outerHTML = '<span style="color:#888">[图加载失败]</span>'
          }
        })
        // 滚动: 刷新/切目标 → 滚到底; 上滚加载更早 → 保持视口
        if (keepScrollOffset == null) box.scrollTop = box.scrollHeight
        else box.scrollTop = box.scrollHeight - keepScrollOffset
      }
      // 聊天文本渲染(2026-09-13 引用消息功能): 把 [Quoted message begins]…[Quoted message ends] 块
      // 渲染成"引用样式"气泡(左边框+灰底), 其余正文照常显示。没有引用块则整段照常。
      function chatRenderText(t) {
        var src = String(t || '')
        var re = /\[Quoted message begins\]([\s\S]*?)\[Quoted message ends\]/g
        var parts = []
        var m, last = 0
        while ((m = re.exec(src)) !== null) {
          if (m.index > last) parts.push('<div>' + linkifyText(esc(mdPlain(src.slice(last, m.index)))) + '</div>')
          var q = (m[1] || '').replace(/^\s*\n/, '').replace(/\n\s*$/, '')
          parts.push('<div style="border-left:3px solid #5b7cfa;background:rgba(91,124,250,.10);padding:5px 9px;margin:2px 0 7px;border-radius:6px;color:#9fb0ff;font-size:12px;white-space:pre-wrap">↩ ' + linkifyText(esc(mdPlain(q))) + '</div>')
          last = m.index + m[0].length
        }
        if (last < src.length) parts.push('<div>' + linkifyText(esc(mdPlain(src.slice(last)))) + '</div>')
        if (!parts.length) parts.push('<div>' + linkifyText(esc(mdPlain(src))) + '</div>')
        return parts.join('')
      }
      // 头像字符: 群友取昵称首字; 私聊/无名兜底
      function chatAvaOf(who) {
        var s = String(who || '').trim()
        if (!s) return '?'
        try { return Array.from(s)[0] } catch (e) { return s[0] || '?' }
      }
      function setChatStatus(msg) {
        var st = document.getElementById('dk-chat-status')
        if (st) st.textContent = msg
      }
      // 结果提示: 短暂保留(列表刷新/计数不覆盖), 到期自动还原
      function flashStatus(msg, ms) {
        chatFlash = msg
        setChatStatus(msg)
        var hold = ms || 3500
        setTimeout(function () {
          if (chatFlash === msg) {
            chatFlash = ''
            var st = document.getElementById('dk-chat-status')
            if (st && st.textContent === msg) renderChatList()
          }
        }, hold)
      }
      function closeLightbox() {
        var ov = document.getElementById('qqs-lightbox')
        if (ov) ov.remove()
      }
      function openLightbox(url) {
        closeLightbox()
        var ov = document.createElement('div')
        ov.id = 'qqs-lightbox'
        ov.innerHTML = '<span class="lb-x">✕</span><img src="' + esc(url) + '" referrerpolicy="no-referrer" alt="图片">'
        document.body.appendChild(ov)
        ov.onclick = closeLightbox
        var x = ov.querySelector('.lb-x')
        if (x) x.onclick = function (e) { e.stopPropagation(); closeLightbox() }
        window.addEventListener('keydown', function h(e) { if (e.key === 'Escape') { closeLightbox(); window.removeEventListener('keydown', h) } })
      }
      function chatUrls(text) {
        var out = []
        var re = /https?:\/\/[^\s]+/g
        var m
        while ((m = re.exec(String(text || ''))) !== null) {
          var u = m[0].replace(/[，。、；：,.;:!！?？)\]】》>」』]+$/, '')
          if (u) out.push(u)
        }
        return out
      }
      function chatKindOfMedia(fullText) {
        if (/\.(jpe?g|png|gif|webp|bmp)(\?|$)/i.test(fullText) || /\[(图片|img):/i.test(fullText)) return 'image'
        if (/\.(mp4|webm|mov|avi)(\?|$)/i.test(fullText) || /\[(视频|video):/i.test(fullText)) return 'video'
        if (/\.(mp3|wav|amr|silk|m4a|ogg)(\?|$)/i.test(fullText) || /\[(语音|voice|音频):/i.test(fullText)) return 'voice'
        return 'file'
      }
      function chatKindLbl(kind) {
        return kind === 'image' ? '图片' : kind === 'video' ? '视频' : kind === 'voice' ? '语音' : '文件'
      }
      // 把文本框里的 [MEDIA:kind|src] 拆出来(src 可为 http 链接或本机路径), 其余为纯文本段
      function chatSplitBbcode(t) {
        var medias = []
        var texts = []
        var re = /\[MEDIA:([^\]|]+)\|([^\]]+)\]/gi
        var m
        var last = 0
        while ((m = re.exec(String(t || ''))) !== null) {
          var pre = t.slice(last, m.index).trim()
          if (pre) texts.push(pre)
          medias.push({ kind: String(m[1]).toLowerCase(), src: String(m[2]).trim() })
          last = m.index + m[0].length
        }
        var tail = t.slice(last).trim()
        if (tail) texts.push(tail)
        // kind 中文兼容: [MEDIA:图片|…]
        medias.forEach(function (x) {
          if (x.kind === '图片' || x.kind === 'img') x.kind = 'image'
          else if (x.kind === '视频' || x.kind === 'video') x.kind = 'video'
          else if (x.kind === '语音' || x.kind === 'voice' || x.kind === '音频') x.kind = 'voice'
          else if (x.kind === '文件' || x.kind === 'file') x.kind = 'file'
          if (x.kind !== 'image' && x.kind !== 'video' && x.kind !== 'voice' && x.kind !== 'file') x.kind = 'file'
        })
        return { medias: medias, texts: texts }
      }
      // 发送单条媒体: src 支持 http(s) 或本机绝对路径; 勾了🧠记入上下文时 host 写「用户代发」模拟消息
      function chatSendMediaOne(kind, src) {
        var body = { ns: state.ns || undefined, scope: state.sendScope, kind: kind }
        var peerId = state.sendScope === 'c2c' ? state.sendTo : state.gid
        if (!peerId) return Promise.resolve({ ok: false, msg: '未选目标' })
        body.peerId = peerId
        if (/^https?:\/\//i.test(src)) body.url = src
        else body.localPath = src
        body.insertContext = state.chatIns === true
        body.relayText = src // 完整来源(路径/URL)进「用户代发」上下文, dock 可渲染/可读
        return apiPost('chat/media', body)
      }
      // 媒体来源的短描述(记入上下文用): 取文件名/链接尾
      function chatMediaDesc(src) {
        var s = String(src || '')
        var i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'))
        var base = i >= 0 ? s.slice(i + 1) : s
        base = base.replace(/[?&#].*$/, '')
        return base || '媒体'
      }
      // 发送中 UI: 禁用发送按钮/输入框(防连点重复发送), 按钮显示进度
      function setSending(on, label) {
        var btn = document.getElementById('dk-chat-send')
        if (btn) { btn.disabled = !!on; btn.textContent = on ? (label || '发送中…') : '发送' }
        var ta = document.getElementById('dk-chat-input')
        if (ta) ta.disabled = !!on
      }
      // 依次发送媒体列表, 全部成功后清空输入并刷新; 部分失败即停并提示
      function chatSendMediaSeq(list, onDone) {
        if (!list.length) { if (onDone) onDone(); return }
        if (state.chatBusy) return // 防重入
        state.chatBusy = 'send'
        setSending(true, '发送中…')
        setChatStatus('正在发送 ' + list.length + ' 个媒体…')
        renderChatList()
        var i = 0
        var step = function () {
          setSending(true, '发送中 ' + (i + 1) + '/' + list.length)
          setChatStatus('正在发送' + chatKindLbl(list[i].kind) + ' ' + (i + 1) + '/' + list.length + '…(完成前勿再点发送)')
          chatSendMediaOne(list[i].kind, list[i].src).then(function (d) {
            if (!d || !d.ok) {
              state.chatBusy = ''; setSending(false)
              flashStatus('发送失败: ' + ((d && (d.msg || d.error)) || '未知') + '(输入已保留, 可改后重发)', 6000)
              return
            }
            i++
            if (i >= list.length) {
              state.chatText = ''; renderChatInput(); state.chatBusy = ''; setSending(false)
              flashStatus('已发送 ' + chatKindLbl(list[0].kind) + (list.length > 1 ? ' ×' + list.length : '') + ' ✓')
              loadChat(true)
              if (onDone) onDone()
            } else step()
          })
        }
        step()
      }
      // 发送入口(kindArg 保留兼容): 有 [MEDIA:…] → 逐条发媒体 + 剩余文字; 否则 纯链接自动判 / 纯文本
      function chatSend(kindArg) {
        if (state.chatBusy) { setChatStatus('正在发送中, 请稍候…'); return }
        if (!state.ns) { setChatStatus('先选账号实例(头部下拉)'); return }
        if (!chatPeerReady()) { setChatStatus('先选一个群/私聊目标'); return }
        var t = (state.chatText || '').trim()
        if (!t) { setChatStatus('先输入内容, 或用 📷插图/📎文件 加入媒体'); return }
        var blk = chatSplitBbcode(t)
        if (blk.medias.length) {
          chatSendMediaSeq(blk.medias, function () {
            if (blk.texts.length && !state.chatBusy) chatSendText(blk.texts.join('\n'))
          })
          return
        }
        var urls = chatUrls(t)
        if (!urls.length) { chatSendText(t); return }
        var kind = chatKindOfMedia(t)
        // 纯链接: 自动当媒体发; 若有残留描述文字(去掉链接后), 媒体成功后补发
        var clean = t.replace(/https?:\/\/[^\s]+/g, '').replace(/\[(图片|附件|文件|语音|视频|音频):\s*\]/g, '').replace(/\[Attachment:[^\]]*\]/g, '').trim()
        chatSendMediaSeq([{ kind: kind, src: urls[0] }], function () { if (clean && !state.chatBusy) chatSendText(clean) })
      }
      function chatSendText(t) {
        if (state.chatBusy) return // 防重入(媒体后补发文本也要等空闲)
        // @ mention: 输入框里的 @<32hex> → QQ 高亮 <@openid>(先保护已手输的 <@…>)
        if (state.sendScope === 'group') {
          t = String(t || '').replace(/<@([A-Za-z0-9]{32})>/g, '\u0001AT$1\u0001')
            .replace(/@([A-Za-z0-9]{32})(?![A-Za-z0-9])/g, '<@$1>')
            .replace(/\u0001AT([A-Za-z0-9]{32})\u0001/g, '<@$1>')
        }
        state.chatBusy = 'send'
        setSending(true, '发送中…')
        setChatStatus('正在发送文本…')
        renderChatList()
        var body = { text: t, ns: state.ns || undefined, insertContext: state.chatIns === true }
        if (state.sendScope === 'c2c') body.openid = state.sendTo
        else body.gid = state.gid
        apiPost(state.sendScope === 'c2c' ? 'chat/send' : 'group/send', body).then(function (d) {
          state.chatBusy = ''
          setSending(false)
          if (d && d.ok) { state.chatText = ''; renderChatInput(); flashStatus(d.msg || '已发送 ✓'); loadChat(true) }
          else flashStatus((d && (d.msg || (d.err && d.err.human) || d.error)) || '发送结果未知', 6000)
        })
      }
      // ── @ mention: 输入框敲 @ 自动弹成员候选, 支持继续输入过滤(昵称/ID) ──
      function chatAtKey() { return (state.ns || '') + ':' + (state.gid || '') }
      function chatLoadAtMembers() {
        if (state.sendScope === 'c2c' || !state.gid) { atM.members = []; chatAtClose(); return }
        var k = chatAtKey()
        if (atM.key === k && atM.members.length) return
        atM.key = k
        var q = 'gid=' + encodeURIComponent(state.gid) + (state.ns ? '&ns=' + encodeURIComponent(state.ns) : '')
        api('group/members_local', q).then(function (d) {
          if (atM.key !== chatAtKey()) return
          atM.members = (d && d.ok && Array.isArray(d.members) ? d.members : []).map(function (m) { return { mid: m.mid, name: m.name || '' } })
          if (atM.open) chatAtRender()
        })
      }
      // 光标前最近一个 @(到光标为止无空格/换行/@): 返回 {start, kw}
      function chatAtCtx(text, caret) {
        var head = String(text || '').slice(0, caret)
        var m = /@([^\s@]*)$/.exec(head)
        if (!m) return null
        return { start: caret - m[0].length, kw: m[1] }
      }
      function chatAtScan() {
        var ta = document.getElementById('dk-chat-input')
        if (!ta) return
        var v = ta.value || ''
        var c = ta.selectionStart == null ? v.length : ta.selectionStart
        var ctx = chatAtCtx(v, c)
        if (!ctx) { chatAtClose(); return }
        if (!atM.members.length) chatLoadAtMembers()
        atM.open = true
        atM.kw = String(ctx.kw).toLowerCase()
        atM.idx = 0
        atM.range = ctx
        chatAtRender()
      }
      function chatAtList() {
        if (!atM.open) return []
        var kw = atM.kw
        if (!kw) return atM.members
        return atM.members.filter(function (m) {
          return (m.name || '').toLowerCase().indexOf(kw) >= 0 || String(m.mid || '').indexOf(kw) >= 0
        })
      }
      function chatAtRender() {
        var pop = document.getElementById('dk-at-pop')
        if (!pop) return
        if (!atM.open) { pop.style.display = 'none'; return }
        var list = chatAtList()
        if (!list.length) { pop.style.display = 'block'; pop.innerHTML = '<div class="dk-at-empty">没有匹配的群成员(成员需先发过言)</div>'; return }
        pop.style.display = 'block'
        pop.innerHTML = list.map(function (m, i) {
          return '<div class="dk-at-item' + (i === atM.idx ? ' on' : '') + '" data-mid="' + esc(m.mid) + '">'
            + '<span>@' + esc(m.name || '(未知名)') + '</span>'
            + '<span style="color:#99a">' + esc(String(m.mid).slice(0, 6)) + '…</span></div>'
        }).join('')
        Array.prototype.forEach.call(pop.querySelectorAll('.dk-at-item'), function (el) {
          el.onmousedown = function (ev) { ev.preventDefault(); chatAtPick(el.getAttribute('data-mid')) }
        })
      }
      function chatAtPick(mid) {
        if (mid == null || !atM.range) return
        var ta = document.getElementById('dk-chat-input')
        if (!ta) return
        var v = state.chatText || ''
        var caret = ta.selectionStart == null ? v.length : ta.selectionStart
        if (caret < atM.range.start) caret = v.length
        state.chatText = v.slice(0, atM.range.start) + '@' + mid + ' ' + v.slice(caret)
        chatAtClose()
        renderChatInput()
        ta.focus()
        var pos = atM.range.start + 1 + String(mid).length + 1
        try { ta.setSelectionRange(pos, pos) } catch (e) { /* 忽略 */ }
      }
      function chatAtClose() {
        atM.open = false
        var pop = document.getElementById('dk-at-pop')
        if (pop) pop.style.display = 'none'
      }
      function chatKindOfFile(f) {
        var t = String((f && f.type) || '').toLowerCase()
        var n = String((f && f.name) || '').toLowerCase()
        if (t.indexOf('image/') === 0 || /\.(jpe?g|png|gif|webp|bmp)$/.test(n)) return 'image'
        if (t.indexOf('video/') === 0 || /\.(mp4|webm|mov|avi)$/.test(n)) return 'video'
        if (t.indexOf('audio/') === 0 || /\.(mp3|wav|amr|silk|m4a|ogg)$/.test(n)) return 'voice'
        return 'file'
      }
      function chatFileExt(f) {
        var n = String((f && f.name) || '')
        var i = n.lastIndexOf('.')
        var e = i >= 0 ? n.slice(i + 1).toLowerCase() : ''
        if (/^[a-z0-9]{1,6}$/.test(e)) return e
        return 'bin'
      }
      // 把 [MEDIA:kind|src] 追加进文本框(不清空已有内容)
      function chatInsertMedia(kind, src) {
        var cur = state.chatText || ''
        if (cur && !/\n$/.test(cur)) cur += '\n'
        state.chatText = cur + '[MEDIA:' + chatKindLbl(kind) + '|' + src + ']'
        renderChatInput()
        var ta = document.getElementById('dk-chat-input')
        if (ta) { ta.focus(); ta.scrollTop = ta.scrollHeight }
        setChatStatus('已插入 ' + chatKindLbl(kind) + ', 点发送即可发出')
      }
      // 处理选中的文件: 有本机路径(Electron 场景)直接用; 否则 base64 上传到 bot 临时目录拿路径
      function chatIngestFiles(files, fromPicker) {
        var list = Array.isArray(files) ? files : []
        if (!list.length) return
        var total = list.length
        var done = 0
        var finish = function () { done++; if (fromPicker && done >= total) { var fp = document.getElementById('dk-chat-file'); if (fp) fp.value = '' } }
        list.forEach(function (f) {
          var kind = chatKindOfFile(f)
          var directPath = ''
          try { if (f.path && /^[a-zA-Z]:[\\/]/.test(String(f.path))) directPath = String(f.path) } catch (e) { directPath = '' }
          if (directPath) { chatInsertMedia(kind, directPath); finish(); return }
          if (f.size > 300 * 1024 * 1024) { setChatStatus('「' + (f.name || '文件') + '」超过 300MB 上限, 请手动输入本机路径'); finish(); return }
          // 一律走流式上传(不限 ~5MB): 浏览器把 File 直接当 body 传, host 写盘后返回本机路径
          var ext = chatFileExt(f)
          setChatStatus('正在上传 ' + (f.name || '文件') + '…')
          var q = 'ns=' + encodeURIComponent(state.ns || '') + '&ext=' + encodeURIComponent(ext)
          fetch('/api/qqbot-settings/chat/upload-raw?' + q, {
            method: 'POST',
            headers: { 'content-type': 'application/octet-stream' },
            body: f,
          }).then(function (r) { return r.json().catch(function () { return null }) }).then(function (d) {
            if (d && d.ok && d.path) { chatInsertMedia(kind, d.path); setChatStatus('已上传 ' + (f.name || '文件') + ', 点发送即可发出') }
            else setChatStatus('上传失败: ' + ((d && (d.error || d.msg)) || '未知'))
            finish()
          }).catch(function () { setChatStatus('上传失败(网络错误)'); finish() })
        })
      }
      function renderChatInput() {
        var ta = document.getElementById('dk-chat-input')
        if (ta) ta.value = state.chatText || ''
        var n = document.getElementById('dk-chat-cnt')
        if (n) n.textContent = (state.chatText || '').length + '/2000'
      }
      function renderJoinList() {
        var box = panel.querySelector('#dk-join-list')
        if (!box) return
        var badgeEl = panel.querySelector('.dk-join-badge')
        if (state.joins === null) { box.innerHTML = '<div class="dk-empty">加载中…</div>'; return }
        if (state.joins.length === 0) { box.innerHTML = '<div class="dk-empty">当前没有待审批的入群申请 ✓</div>'; return }
        box.innerHTML = state.joins.map(function (j) {
          var busying = state.busy === 'ap-' + j.member_openid
          return '<div class="dk-item">'
            + '<span style="font-weight:600">' + esc(j.username) + '</span>'
            + '<span style="color:#999;font-size:12px">' + esc(j.source) + '</span>'
            + (j.verify ? '<span style="color:#666;font-size:12px">验证: ' + esc(j.verify) + '</span>' : '')
            + (j.risk ? '<span style="color:#c23131;font-size:12px">⚠ ' + esc(j.risk) + '</span>' : '')
            + '<span style="flex:1"></span>'
            + '<button class="dk-btn ok" data-ap="approve" data-mid="' + esc(j.member_openid) + '"' + (busying ? ' disabled' : '') + '>' + (busying ? '处理中…' : '通过') + '</button>'
            + '<button class="dk-btn no" data-ap="decline" data-mid="' + esc(j.member_openid) + '"' + (busying ? ' disabled' : '') + '>拒绝</button>'
            + '</div>'
        }).join('')
        box.querySelectorAll('button[data-ap]').forEach(function (btn) {
          btn.onclick = function () { doApprove(btn.getAttribute('data-mid'), btn.getAttribute('data-ap')) }
        })
        if (badgeEl) { badgeEl.style.display = 'inline-block'; badgeEl.textContent = state.joins.length }
      }
      function renderMemberList() {
        var box = panel.querySelector('#dk-member-list')
        if (!box) return
        if (state.members === null) { box.innerHTML = '<div class="dk-empty">加载中…</div>'; return }
        if (state.members.length === 0) { box.innerHTML = '<div class="dk-empty">暂无成员记录 —— 群友发言后自动出现(官方成员列表未开放)</div>'; return }
        box.innerHTML = state.members.map(function (m) {
          var busying = state.busy === 'm-' + m.mid
          return '<div class="dk-item">'
            + '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(m.name || '(未知名)') + ' · ' + esc(String(m.mid).slice(0, 10)) + '…</span>'
            + '<input class="qqs-txt" data-min="' + esc(m.mid) + '" type="number" min="1" value="' + esc(state.muteSecs) + '" style="width:64px">'
            + '<span style="color:#999;font-size:12px">分钟</span>'
            + '<button class="dk-btn no" data-mute="' + esc(m.mid) + '"' + (busying ? ' disabled' : '') + '>' + (busying ? '处理中…' : '禁言') + '</button>'
            + '</div>'
        }).join('')
        box.querySelectorAll('input[data-min]').forEach(function (inp) {
          inp.oninput = function () { state.muteSecs = inp.value }
        })
        box.querySelectorAll('button[data-mute]').forEach(function (btn) {
          btn.onclick = function () { doMute(btn.getAttribute('data-mute'), 'mute', Number(state.muteSecs || 60) * 60) }
        })
      }
      function renderMuteList() {
        var box = panel.querySelector('#dk-mute-list')
        if (!box) return
        if (state.mutes === null) { box.innerHTML = '<div class="dk-empty">加载中…</div>'; return }
        if (state.mutes.length === 0) { box.innerHTML = '<div class="dk-empty">没有正在禁言的成员</div>'; return }
        box.innerHTML = state.mutes.map(function (m) {
          var busying = state.busy === 'm-' + m.member_openid
          return '<div class="dk-item">'
            + '<span style="flex:1">' + esc(m.username || String(m.member_openid).slice(0, 12)) + '</span>'
            + '<span style="color:#999;font-size:12px">至 ' + esc(String(m.expire || '').replace('T', ' ').slice(0, 16)) + '</span>'
            + '<button class="dk-btn" data-um="' + esc(m.member_openid) + '"' + (busying ? ' disabled' : '') + '>' + (busying ? '处理中…' : '解除') + '</button>'
            + '</div>'
        }).join('')
        box.querySelectorAll('button[data-um]').forEach(function (btn) {
          btn.onclick = function () { doMute(btn.getAttribute('data-um'), 'unmute') }
        })
      }
      function renderPanel() {
        panel.innerHTML = '<div class="dk-h"></div><div class="dk-detect"></div><div class="dk-b"></div>'
        paintHead(); paintDetect(); paintBody()
        if (state.tab === 'join') loadJoins()
        // 每次展开都重查当前 web 会话(跟随主人切换会话; 不打断已有手动选择)
        if (sessionsSvc || true) { reDetectAndSelect() }
      }
      // 检测状态条: 显示 web 当前会话的 sessionId 与反查结果(悬浮球调试/自动选中依据)
      function paintDetect() {
        if (!panel || !open) return
        var d = panel.querySelector('.dk-detect')
        if (!d) return
        var det = state.detected
        var sids = (det && det.sid) || ''
        var srcLbl = det ? (det.src === 'sessions.list' ? 'sessions.list' : det.src === 'localStorage' ? 'localStorage' : '未检测到') : '检测中…'
        var hit = state.detectedHit
        var hitTxt = '未命中 QQ 会话'
        if (hit) {
          hitTxt = (hit.scope === 'group' ? '群「' : '私聊「') + esc((hit.name || '') + '」' + (hit.ns ? ' [' + hit.ns + ']' : '')) + (hit.peerId ? ' · ' + hit.peerId.slice(0, 10) + '…' : '')
        }
        d.innerHTML = '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:6px 14px;background:#f4f0ff;border-bottom:1px solid #efe8ff;font-size:12px;color:#4a3a9f">'
          + '<span style="font-weight:700">📡 当前会话</span>'
          + '<span style="color:#666">来源:' + esc(srcLbl) + '</span>'
          + (sids ? '<code style="font-size:11px;background:#fff;border:1px solid #e3d9ff;border-radius:5px;padding:1px 6px">' + esc(sids.slice(0, 36)) + (sids.length > 36 ? '…' : '') + '</code>' : '<span style="color:#999">(无)</span>')
          + '<span style="color:#2f9e44">→ ' + hitTxt + '</span>'
          + '<button class="dk-btn" id="dk-redetect" style="padding:1px 8px;font-size:11px;margin-left:auto">🔄 重查</button>'
          + '</div>'
        var btn = d.querySelector('#dk-redetect')
        if (btn) btn.onclick = function () { reDetectAndSelect() }
      }
      // 重新检测当前 web 会话并自动选中对应 QQ 目标
      function reDetectAndSelect() {
        state.detected = null; state.detectedHit = null
        state.wantPeer = null
        paintDetect()
        lookupCurrentSession(function (hit) {
          if (!state.accts.length) { api('accounts').then(function (dd) { var list = (dd && Array.isArray(dd.instances) ? dd.instances : []).filter(function (a) { return !a.disabled }); state.accts = list; applyHit(hit, list) }) }
          else applyHit(hit, state.accts)
        })
      }
      function applyHit(hit, list) {
        if (hit && list.length) {
          state.ns = hit.ns || list[0].ns || ''
          state.wantPeer = { scope: hit.scope, peerId: hit.peerId }
          if (hit.scope === 'c2c') { state.sendScope = 'c2c'; state.sendTo = hit.peerId; state.sendName = hit.name || '' }
          else { state.sendScope = 'group'; state.gid = hit.peerId }
        } else if (list.length && !state.ns) {
          state.ns = list[0].ns || ''
        }
        refreshAll(); paintHead(); paintDetect()
      }
      loadAccts()
      // 首次自动展开?不——保持球形态(审批/提问仍走打断弹出)。主人点开才展开。
      closePanel()
    }

    function apply(ctx) {
      ensureCss()
      var slots = ctx.slots
      if (!slots) { console.warn('[qqbot-settings] slots unavailable'); return }
      slots.inject('settings.section', function () {
        return slots.register(
          { name: 'settings.section', id: 'qqbot', order: 32, label: 'QQ 机器人' },
          function (props) { return h(QqbotHome, { close: props && props.close }) })
      })
      startApprovalFloat()
      // sessions 服务(宿主根服务): 权威读 web 当前会话(current)与 cwd(agent id === session id)
      var sessionsSvc = null
      try { sessionsSvc = (ctx && (ctx.sessions || (ctx.get && ctx.get('sessions')))) || null } catch (e) { sessionsSvc = null }
      if (!sessionsSvc) { try { sessionsSvc = ctx.get && ctx.get('sessions') } catch (e) {} }
      startQqDock(sessionsSvc)
    }

    exports.inject = ['slots', 'sessions']
    exports.apply = apply
    return module.exports
  }
})
