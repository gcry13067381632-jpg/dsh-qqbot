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
              schedule: v.schedule && Array.isArray(v.schedule.targets) ? v.schedule : { targets: [] },
              // groupPrompt 必须读回来, 否则每次保存都会把它清空成 ''
              // undefined(从未设置)→ 显示默认守则; ''(用户明确清空)→ 保持空(无守则)
              groupPrompt: typeof v.groupPrompt === 'string' ? v.groupPrompt : DEFAULT_GROUP_PROMPT,
              enableApprovals: v.enableApprovals === true,
              approvalTimeoutMs: typeof v.approvalTimeoutMs === 'number' ? v.approvalTimeoutMs : 120000,
              outboundMode: (v.outboundMode === 'silent' || v.outboundMode === 'nothink' ? v.outboundMode : (v.outboundMode === 'passive' ? 'passive' : 'adaptive')),
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
          outboundMode: cfg.outboundMode === 'silent' || cfg.outboundMode === 'nothink' ? cfg.outboundMode : (cfg.outboundMode === 'passive' ? 'passive' : 'adaptive'),
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
              schedule: v2.schedule && Array.isArray(v2.schedule.targets) ? v2.schedule : { targets: [] },
              groupPrompt: typeof v2.groupPrompt === 'string' ? v2.groupPrompt : (typeof cfg.groupPrompt === 'string' ? cfg.groupPrompt : DEFAULT_GROUP_PROMPT),
              enableApprovals: v2.enableApprovals === true,
              approvalTimeoutMs: typeof v2.approvalTimeoutMs === 'number' ? v2.approvalTimeoutMs : 120000,
              outboundMode: (v2.outboundMode === 'silent' || v2.outboundMode === 'nothink' ? v2.outboundMode : (v2.outboundMode === 'passive' ? 'passive' : 'adaptive')),
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
          h('div', { style: { fontSize: 12, color: '#666', margin: '10px 0 2px' } }, '出站方式(连发消息 QQ 端丢失时切主动):'),          h('div', { style: { display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' } },            ['adaptive', 'passive', 'silent', 'nothink'].map(function (m) {              var cur = (cfg.outboundMode || 'adaptive'); if (cur === 'active') cur = 'adaptive';              return h('label', { style: { display: 'inline-flex', gap: 5, alignItems: 'center', fontSize: 12, color: '#333', cursor: 'pointer' } },                h('input', { type: 'radio', name: 'qqs-outbound', checked: cur === m, onChange: function () { setCfg(function (c) { return Object.assign({}, c, { outboundMode: m }) }) } }),                m === 'adaptive' ? '适配主动(推荐默认)' : (m === 'passive' ? '被动(只回最后一句)' : (m === 'silent' ? '完全不出站(静默)' : '完全不思考(QQ入站不唤醒,仅设置页)')))            })),          h('div', { style: { fontSize: 12, color: '#888' } }, '适配主动=刚收到真人消息时前5条带引用回你, 第6条起自动转独立新消息(连发不被QQ吞); 一段时间没新消息的主动推送(定时等)也走独立消息。被动=始终回你那条(连发约4~5条后被QQ吞)。完全不出站=照常思考但不向QQ发任何回复(鲸鱼娘可用工具切回)。完全不思考=QQ入站不唤醒AI, 消息只记录(仅本页可开; 唤醒请发 /outmode adaptive)。保存即热更新, 不用重启。'),          h('div', { style: { fontSize: 12, color: '#666', margin: '10px 0 2px' } }, '延迟聚合(另一套机制,和上面冷却不冲突): 她收到消息先等一小会儿, 把连发的话攒一起综合回, 免得只回第一句。'),
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
          verify: (j.verify_info && j.verify_info.verify_message) || (j.verify_info && j.verify_info.method) || '',
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
        // 台账里没有但成员表有名字的 openid 也补上(私聊候选)
        Object.keys(nameByMid).forEach(function (mid) {
          if (!seen[mid]) { seen[mid] = 1; c2c.push({ scope: 'c2c', id: mid, name: nameByMid[mid].name, lastSeen: nameByMid[mid].ts, count: 0 }) }
        })
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
    var DOCK_CSS2 = "#qqs-dock-panel .dk-chat-head{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:0 0 6px}#qqs-dock-panel .dk-chat-box{overflow-y:auto;overscroll-behavior:contain;background:#f5f6f8;border:1px solid #e6e8ec;border-radius:10px;padding:10px 12px;box-sizing:border-box;height:min(36vh,300px);min-height:140px;scroll-behavior:auto}#qqs-dock-panel .dk-chat-box::-webkit-scrollbar{width:6px}#qqs-dock-panel .dk-chat-box::-webkit-scrollbar-thumb{background:#d3d7dd;border-radius:3px}#qqs-dock-panel .dk-crow{display:flex;gap:8px;align-items:flex-start;margin:0 0 12px}#qqs-dock-panel .dk-crow.out{flex-direction:row-reverse}#qqs-dock-panel .dk-ava{width:32px;height:32px;border-radius:50%;flex:none;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:600;color:#fff;overflow:hidden;user-select:none;background:linear-gradient(150deg,#8fb3e8,#5f8fd9)}#qqs-dock-panel .dk-crow.out .dk-ava{background:linear-gradient(150deg,#5ec7f2,#3b8fe0)}#qqs-dock-panel .dk-cmain{display:flex;flex-direction:column;max-width:calc(100% - 40px);min-width:0}#qqs-dock-panel .dk-crow.in .dk-cmain{align-items:flex-start}#qqs-dock-panel .dk-crow.out .dk-cmain{align-items:flex-end}#qqs-dock-panel .dk-cmeta{font-size:11px;color:#9aa0a8;margin:0 6px 2px;max-width:100%;display:flex;align-items:center;gap:5px;flex-wrap:wrap}#qqs-dock-panel .dk-crow.out .dk-cmeta{flex-direction:row-reverse}#qqs-dock-panel .dk-cbubble{padding:7px 11px;font-size:13px;line-height:1.55;white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere;box-shadow:0 1px 2px rgba(20,30,60,.06);max-width:100%}#qqs-dock-panel .dk-crow.in .dk-cbubble{background:#fff;border:1px solid #e3e6ea;color:#1f2329;border-radius:3px 10px 10px 10px}#qqs-dock-panel .dk-crow.out .dk-cbubble{background:linear-gradient(180deg,#69a6ff,#3d7df5);color:#fff;border-radius:10px 3px 10px 10px}#qqs-dock-panel .dk-img{display:block;max-width:min(230px,52vw);max-height:200px;border-radius:6px;margin:0 0 3px;object-fit:cover;cursor:zoom-in}#qqs-dock-panel .dk-audio{display:block;max-width:min(260px,60vw);width:100%;height:34px;margin:0 0 2px}#qqs-dock-panel .dk-file{display:inline-flex;align-items:center;gap:5px;max-width:100%;padding:6px 12px;border-radius:8px;background:#f0f6ff;border:1px solid #cfe0fa;color:#2b6bd8;font-size:13px;text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}#qqs-dock-panel .dk-file:hover{background:#e2edff}#qqs-dock-panel .dk-video{display:block;max-width:min(260px,60vw);max-height:180px;border-radius:6px;margin:0 0 2px}#qqs-dock-panel .dk-ctag{display:inline-block;font-size:10px;color:#5b8ff0;background:#eaf2ff;border:1px solid #d4e3fd;border-radius:8px;padding:0 6px}#qqs-dock-panel .dk-chat-top{text-align:center;color:#b0b4bb;font-size:11px;padding:2px 0 6px;user-select:none}#qqs-dock-panel .dk-chat-bottom{text-align:center;color:#c3c7cd;font-size:11px;padding:6px 0 0}#qqs-dock-panel .dk-composer{margin-top:8px;border:1px solid #e3e6ea;border-radius:10px;background:#fff;overflow:visible}#qqs-dock-panel .dk-composer textarea{width:100%;box-sizing:border-box;border:none;outline:none;resize:none;font:inherit;font-size:13px;color:#1f2329;background:transparent;padding:8px 10px 4px;line-height:1.5;max-height:120px}#qqs-dock-panel .dk-cbar{display:flex;align-items:center;gap:4px;padding:4px 8px 6px;flex-wrap:wrap}#qqs-dock-panel .dk-cbar .dk-btn{padding:3px 10px;font-size:12px;border-radius:7px}#qqs-dock-panel .dk-cbar .dk-send{background:linear-gradient(180deg,#69a6ff,#3d7df5);color:#fff;border:none;border-radius:8px;padding:5px 18px;font-size:13px;font-weight:600;cursor:pointer}#qqs-dock-panel .dk-cbar .dk-send:disabled{opacity:.5;cursor:default}#qqs-lightbox{position:fixed;inset:0;z-index:2147483000;background:rgba(8,10,18,.82);display:flex;align-items:center;justify-content:center;cursor:zoom-out}#qqs-lightbox img{max-width:92vw;max-height:92vh;border-radius:8px;box-shadow:0 10px 60px rgba(0,0,0,.6)}#qqs-dock-panel .dk-composer{position:relative}#qqs-dock-panel .dk-at-pop{position:absolute;left:6px;bottom:calc(100% - 4px);z-index:30;min-width:200px;max-width:90%;max-height:190px;overflow-y:auto;background:#fff;border:1px solid #e0e4ea;border-radius:10px;box-shadow:0 8px 24px rgba(30,40,80,.16);padding:4px;display:none}#qqs-dock-panel .dk-at-item{display:flex;align-items:center;gap:6px;padding:5px 9px;border-radius:7px;cursor:pointer;font-size:12px;color:#1f2329;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#qqs-dock-panel .dk-at-item.on,#qqs-dock-panel .dk-at-item:hover{background:#eef3ff;color:#2b5fd0}#qqs-dock-panel .dk-at-empty{color:#aaa;font-size:12px;padding:6px 9px}#qqs-lightbox .lb-x{position:fixed;right:16px;top:10px;color:#fff;font-size:30px;cursor:pointer;line-height:1;padding:6px}#qqs-dock-panel.dk-full{left:0!important;top:0!important;right:0!important;bottom:0!important;width:100vw!important;max-width:100vw!important;height:100vh!important;max-height:100vh!important;border-radius:0;z-index:2147482000;display:flex;flex-direction:column}#qqs-dock-panel.dk-full .dk-h,#qqs-dock-panel.dk-full .dk-detect{flex:none}#qqs-dock-panel.dk-full .dk-b{flex:1;min-height:0;overflow:hidden;display:flex;flex-direction:column;padding:8px 14px 6px}#qqs-dock-panel.dk-full .dk-chat-wrap{display:flex;flex-direction:column;flex:1;min-height:0}#qqs-dock-panel.dk-full .dk-chat-head{flex:none}#qqs-dock-panel.dk-full .dk-chat-box{flex:1;height:auto!important;min-height:0!important;max-height:none!important;overflow-y:auto;overscroll-behavior:contain}#qqs-dock-panel.dk-full .dk-composer{flex:none;margin-top:6px}"
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
      var state = { ns: '', accts: [], gid: '', groups: [], tab: 'chat', sendScope: 'group', sendTo: '', sendName: '', sendText: '', insertCtx: true, targetQ: '', c2cs: [], joins: null, mutes: null, members: null, muteSecs: '60', bindGid: '', bindName: '', msg: '', busy: '', wantPeer: null, lookedUp: false, detected: null, detectedHit: null, chatItems: [], chatMore: false, chatBusy: '', chatErr: '', chatOldest: 0, chatText: '', chatIns: true, outMode: '', outRev: undefined, bpEvents: [], bpSel: null, bpDraft: null }
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
      // ⚙️ 出站方式: 读当前账号(ns)配置
      function loadOutMode() {
        if (state.tab !== 'out') return
        fetch(READ + (state.ns ? '?' + outNsQ() : '')).then(function (r) { return r.json() }).then(function (d) {
          if (d && d.value) { state.outMode = (d.value.outboundMode === 'silent' || d.value.outboundMode === 'nothink' ? d.value.outboundMode : (d.value.outboundMode === 'passive' ? 'passive' : 'adaptive')); state.outRev = d.revision; paintBody() }
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
            if (d && d.value) { state.outMode = (d.value.outboundMode === 'silent' || d.value.outboundMode === 'nothink' ? d.value.outboundMode : (d.value.outboundMode === 'passive' ? 'passive' : 'adaptive')); state.outRev = d.revision; var h2 = panel ? panel.querySelector('#dk-out-hint') : null; if (h2) h2.textContent = '已保存 ✓ live 热更新已生效(不用重启)' }
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
          state.groups = (d && Array.isArray(d.groups) ? d.groups : []).map(function (g) { return { gid: g.gid, name: g.name || '', from: g.from || '' } })
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
        // 与定时任务同款三源合并: 台账 + 本地成员表补名(不露裸 id)
        var qNs = state.ns ? ('?ns=' + encodeURIComponent(state.ns)) : ''
        var qDD = dd ? ('?dataDir=' + encodeURIComponent(dd)) : ''
        Promise.all([
          api('known-chats', qDD.replace('?', '')),
          api('group/members_local', qNs.replace('?', '')),
        ]).then(function (rs) {
          var known = ((rs[0] && rs[0].chats) || [])
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
          Object.keys(nameByMid).forEach(function (mid) {
            if (!seen[mid]) { seen[mid] = 1; c2c.push({ id: mid, name: nameByMid[mid].name, lastSeen: nameByMid[mid].ts, count: 0 }) }
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
          state.joins = (d && d.ok && Array.isArray(d.list) ? d.list : []).map(function (j) { return { member_openid: j.member_openid, username: j.username || '(未知昵称)', verify: (j.verify_info && (j.verify_info.verify_message || j.verify_info.method)) || '', risk: j.risk_tips || '', source: j.apply_source === 'invited' ? '被邀请' : '主动申请' } })
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
          + '<button data-t="chat" class="' + (state.tab === 'chat' ? 'on' : '') + '">💬 聊天</button>'
          + '<button data-t="join" class="' + (state.tab === 'join' ? 'on' : '') + '">📥 入群审批<span class="dk-join-badge" style="display:none;background:#ff4d4f;color:#fff;border-radius:8px;font-size:11px;padding:0 5px;margin-left:4px">0</span></button>'
          + '<button data-t="mute" class="' + (state.tab === 'mute' ? 'on' : '') + '">🔇 禁言</button>'
          + '<button data-t="out" class="' + (state.tab === 'out' ? 'on' : '') + '">⚙️ 出站</button>'
          + '<button data-t="bp" class="' + (state.tab === 'bp' ? 'on' : '') + '">🎮 互动事件</button>'
          + '</div>'
        var body = tabs
        var status = state.msg ? '<div class="dk-msg" style="color:#2f9e44;margin:4px 0">' + esc(state.msg) + '</div>' : ''
        if (!state.ns || state.accts.length === 0) {
          body += '<div class="dk-empty">还没有配置机器人账号 → 到「账号与预设」页添加后再回来</div>'
        } else if (state.tab === 'send') {
          body += '<div class="dk-row">目标类型: '
            + '<label style="display:inline-flex;align-items:center;gap:4px"><input type="radio" name="dk-scope" value="group"' + (state.sendScope !== 'c2c' ? ' checked' : '') + '> 群聊</label> '
            + '<label style="display:inline-flex;align-items:center;gap:4px"><input type="radio" name="dk-scope" value="c2c"' + (state.sendScope === 'c2c' ? ' checked' : '') + '> 私聊</label></div>'
          body += '<div class="dk-row" style="margin:2px 0 4px">'
            + '<input class="qqs-txt" id="dk-target-search" placeholder="' + (state.sendScope === 'c2c' ? '🔍 搜私聊对象(昵称/ID)…' : '🔍 搜群(备注/昵称/ID)…') + '" value="' + esc(state.targetQ || '') + '" style="width:100%;box-sizing:border-box;font-size:12px;padding:4px 8px">'
            + '<span class="dk-msg" id="dk-target-count"></span></div>'
          var targetSel = state.sendScope === 'c2c'
            ? '<select class="qqs-sel" id="dk-c2c" style="min-width:220px">' + (c2cOpts || '<option value="">暂无私聊对象</option>') + '</select>'
            : groupSelHtml
          body += '<div class="dk-row" id="dk-target-row">' + targetSel + '</div>'
          body += '<textarea class="qqs-txt" id="dk-text" rows="3" style="width:100%;box-sizing:border-box;margin:6px 0" placeholder="输入内容…(@某人 用 &lt;@对方openid&gt; 无斜杠)">' + esc(state.sendText) + '</textarea>'
          body += '<div class="dk-row">'
            + '<label style="display:inline-flex;align-items:center;gap:5px;font-size:12px;color:#666;cursor:pointer" title="发完后往该会话写入一条「用户代你发送: …」的模拟用户消息(web 流可见、不唤醒、不开回合;标记不会发到 QQ)">'
            + '<input type="checkbox" id="dk-insctx"' + (state.insertCtx ? ' checked' : '') + '> 🧠 记入 bot 上下文(模拟用户消息·不唤醒)</label>'
            + '<span style="flex:1"></span>'
            + '<button class="dk-btn ok" id="dk-send">🚀 发送到 ' + (state.sendScope === 'c2c' ? ('私聊「' + esc(c2cSelName()) + '」') : '群「' + esc(groupSelName()) + '」') + '</button>'
            + '<span class="dk-msg">已输 ' + state.sendText.length + '/2000</span></div>'
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
        } else if (state.tab === 'out') {
          var om = state.outMode || 'adaptive'
          if (om === 'nothink') body += '<div class="dk-msg" style="color:#c23131;margin:2px 0">⚠️ 当前为「完全不思考」(设置页开启): QQ 入站不唤醒 AI。发 /outmode adaptive 可唤醒。</div>'
          body += '<div class="dk-row" style="font-weight:700;font-size:13px;margin:4px 0 2px">⇄ 出站方式(保存即热更新,不用重启)</div>'
          body += '<div class="dk-row">'
            + ['adaptive','passive','silent'].map(function (m2) { return '<label style="display:inline-flex;align-items:center;gap:4px;cursor:pointer;font-size:12px;color:#333"><input type="radio" name="dk-outmode" value="' + m2 + '"' + (om === m2 ? ' checked' : '') + '> ' + (m2==='adaptive' ? '适配主动(推荐默认)' : (m2==='passive' ? '被动(只回最后一句)' : '完全不出站(静默)')) + '</label>' }).join('')
            + '</div>'
          body += '<div class="dk-msg" style="line-height:1.6">适配主动=和QQ有关的会话回复都发到QQ: 刚收到真人消息时前5条带引用回你(能看到回的是哪句), 第6条起自动转独立新消息, 连发不被QQ吞; 定时/后台等没有新真人消息的主动推送也走独立消息。'
          body += '被动=始终以「回复你那条」发出, 连发约4~5条后会被QQ吞掉。完全不出站=本机静默, 不向QQ发任何回复(鲸鱼娘可用工具随时切回)。本开关对纯web(没绑QQ)的会话不生效。</div>'
          body += '<span class="dk-msg" id="dk-out-hint" style="color:#2f9e44;margin:4px 0"></span>'
        } else if (state.tab === 'bp') {
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
            else if (state.tab === 'bp') loadBotplay()
            else if (state.tab === 'chat') { state.chatItems = []; state.chatErr = ''; }
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
        var bpNew = panel.querySelector('#dk-bp-new')
        if (bpNew) bpNew.onclick = function () {
          state.bpSel = null
          state.bpDraft = { id: '', name: '', maxClicks: 0, expireSec: 600, buttonsPerRow: 1, perm: { type: 'all', userIds: [] }, buttons: [{ id: 'b1', label: '按钮', botAction: { type: 'reply_text', text: '' }, llmEffect: { mode: 'no_append', contextText: '' } }] }
          paintBody()
        }
        // 编辑器字段(名称/id/有效期/总次数/权限)
        var bpName = panel.querySelector('#dk-bp-name')
        if (bpName) bpName.oninput = function (e) { state.bpDraft.name = e.target.value }
        var bpId = panel.querySelector('#dk-bp-id')
        if (bpId) bpId.oninput = function (e) { state.bpDraft.id = e.target.value.trim() }
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
      // 🎮 互动事件装配器: 读/存(全量 patch 只带 botplayEvents; settings.update 部分合并 + revision 乐观锁)
      function loadBotplay() {
        if (state.tab !== 'bp') return
        fetch(READ + (state.ns ? '?' + outNsQ() : '')).then(function (r) { return r.json() }).then(function (d) {
          if (d && d.value) {
            state.bpEvents = Array.isArray(d.value.botplayEvents) ? JSON.parse(JSON.stringify(d.value.botplayEvents)) : []
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
        var trySave = function (curVal, curRev) {
          var patch = Object.assign({}, curVal || {}, { botplayEvents: state.bpEvents })
          return fetch(UPDATE, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ns: state.ns || undefined, patch: patch, expectedRevision: curRev }),
          }).then(function (r) { return r.json().catch(function () { return null }) }).then(function (d) {
            if (d && d.value) {
              state.bpEvents = Array.isArray(d.value.botplayEvents) ? d.value.botplayEvents : []
              var h2 = panel.querySelector('#dk-bp-hint'); if (h2) h2.textContent = '✅ 已保存(共 ' + state.bpEvents.length + ' 个事件, live 热更已生效)' 
            } else {
              var conflicted = !!(d && d.error && String(d.error).indexOf('changed since it was read') >= 0)
              if (conflicted) { fetch(READ + (state.ns ? '?' + outNsQ() : '')).then(function (r) { return r.json() }).then(function (dd) { if (dd && dd.value) trySave(dd.value, dd.revision) }).catch(function () {}) }
              else { var h3 = panel.querySelector('#dk-bp-hint'); if (h3) h3.textContent = '保存失败: ' + ((d && d.error) || '未知错误') }
            }
          }).catch(function () { var h4 = panel.querySelector('#dk-bp-hint'); if (h4) h4.textContent = '保存异常' })
        }
        fetch(READ + (state.ns ? '?' + outNsQ() : '')).then(function (r) { return r.json() }).then(function (d0) {
          if (d0 && d0.value) trySave(d0.value, d0.revision)
          else { var h5 = panel.querySelector('#dk-bp-hint'); if (h5) h5.textContent = '保存失败: 无法读取当前设置' }
        }).catch(function () { var h6 = panel.querySelector('#dk-bp-hint'); if (h6) h6.textContent = '保存失败: 读取异常' })
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
            if (k === 'file') return '<a class="dk-file" href="' + esc(u) + '" target="_blank" rel="noopener" title="' + esc(u) + '">📎 ' + esc((m && m.name) || '文件') + '</a>'
            if (k === 'voice') return '<audio class="dk-audio" controls preload="metadata" src="' + esc(u) + '"></audio>'
            if (k === 'video') return '<video class="dk-video" controls preload="metadata" src="' + esc(u) + '"></video>'
            return '<img class="dk-img" loading="lazy" data-lb="' + esc(u) + '" src="' + esc(u) + '" referrerpolicy="no-referrer" alt="[图片]" onerror="this.outerHTML=\'<span style=color:#888>[图加载失败]</span>\'">'
          }).join('')
          var txt = it.text ? '<div>' + esc(mdPlain(it.text)) + '</div>' : ''
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
          var lb = img.getAttribute('data-lb') || img.src
          img.onclick = function (e) { e.preventDefault(); e.stopPropagation(); openLightbox(lb) }
          img.oncontextmenu = function (e) { e.preventDefault(); e.stopPropagation(); openLightbox(lb) }
        })
        // 滚动: 刷新/切目标 → 滚到底; 上滚加载更早 → 保持视口
        if (keepScrollOffset == null) box.scrollTop = box.scrollHeight
        else box.scrollTop = box.scrollHeight - keepScrollOffset
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
