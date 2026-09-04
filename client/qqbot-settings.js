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
    var boxStyle = { border: '1px solid #8883', borderRadius: 8, padding: '6px 10px 8px', margin: '8px 0' }
    var sectionTitle = { fontWeight: 600, margin: '10px 0 2px' }

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
          h('div', { style: { fontSize: 12, color: '#666', margin: '10px 0 2px' } }, '延迟聚合(另一套机制,和上面冷却不冲突): 她收到消息先等一小会儿, 把连发的话攒一起综合回, 免得只回第一句。'),
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

        h('div', { style: { margin: '12px 0' } },
          h('button', { className: 'qqs-btn', style: { marginRight: 8 }, onClick: save }, '保存'),
          h('button', { className: 'qqs-btn', onClick: load }, '放弃修改(重新读取)')),
        msg ? h('p', { style: { fontSize: 13, color: '#2f9e44' } }, msg) : null,
        close ? h('button', { className: 'qqs-btn', onClick: close, style: { float: 'right' } }, '完成') : null)
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
    function WakeEditor(props) {
      // 多账号: 定时唤醒按当前账号 ns 读写
      var _wkNs = props && props.acct && props.acct.ns && props.acct.ns !== 'im-qqbot' ? String(props.acct.ns) : ''
      var [cfg, setCfg] = useState(null)
      var [rev, setRev] = useState(undefined)
      var [expanded, setExpanded] = useState({})
      var [knownChats, setKnownChats] = useState(null)
      var [msg, setMsg] = useState('')
      function load() {
        fetch(READ + (_wkNs ? '?ns=' + encodeURIComponent(_wkNs) : '')).then(function (r) { return r.json() }).then(function (d) {
          if (d && d.value) { setCfg(d.value); setRev(d.revision); setMsg('') }
          else { setMsg('读取失败: ' + JSON.stringify(d)) }
        }).catch(function (e) { setMsg('读取异常: ' + e.message) })
      }
      useEffect(function () { load() }, [])
      var _wkDD = props && props.acct && props.acct.dataDir ? String(props.acct.dataDir) : ''
      useEffect(function () {
        fetch('/api/qqbot-settings/known-chats' + (_wkDD ? '?dataDir=' + encodeURIComponent(_wkDD) : '')).then(function (r) { return r.json() }).then(function (d) {
          if (d && Array.isArray(d.chats)) setKnownChats(d.chats)
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
      function chatOptions(scope) { var all = knownChats || []; return all.filter(function (x) { return x.scope === scope }) }
      function toggleTarget(tid) { setExpanded(function (e) { var n = { ...e }; if (n[tid]) delete n[tid]; else n[tid] = true; return n }) }
      function addTarget() {
        var list = targets().slice()
        var tid = 'tg-' + Date.now().toString(36)
        list.push({ id: tid, name: '', scope: 'group', targetId: '', tasks: [{ id: 't-' + Date.now().toString(36), time: '09:00', enabled: true, prompt: '' }] })
        setTargets(list)
        setExpanded(function (e) { return { ...e, [tid]: true } })
      }
      function updTarget(i, patch) { var list = targets().slice(); list[i] = { ...list[i], ...patch }; setTargets(list) }
      function rmTarget(id) { setTargets(targets().filter(function (t) { return t.id !== id })) }
      function addTaskOf(ti) {
        var list = targets().slice()
        var tg = { ...list[ti], tasks: (list[ti].tasks || []).slice() }
        tg.tasks.push({ id: 't-' + Date.now().toString(36), time: '09:00', enabled: true, prompt: '' })
        list[ti] = tg; setTargets(list)
      }
      function updTaskOf(ti, ji, patch) {
        var list = targets().slice()
        var tg = { ...list[ti], tasks: (list[ti].tasks || []).slice() }
        tg.tasks[ji] = { ...tg.tasks[ji], ...patch }
        list[ti] = tg; setTargets(list)
      }
      function rmTaskOf(ti, tid) {
        var list = targets().slice()
        var tg = { ...list[ti], tasks: (list[ti].tasks || []).filter(function (t) { return t.id !== tid }) }
        list[ti] = tg; setTargets(list)
      }
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
      return h('div', null,
        h('p', { style: { fontSize: 12, color: '#ffa94d' } }, '⚠️ QQ 平台限制:主动发私聊需要对方 48 小时内跟机器人说过话,超时会拒收(会自动降级试别的通道);群一般没问题。想验证:时刻设成 1~2 分钟后,保存后等着看。'),
        targets().map(function (tg, ti) {
          var open = !!expanded[tg.id]
          var taskN = (tg.tasks || []).length
          var scopeTag = tg.scope === 'c2c' ? '私聊' : '群'
          var curChat = null
          if (knownChats) {
            curChat = knownChats.filter(function (c) { return c.scope === tg.scope && c.id === tg.targetId })[0] || null
          }
          var curLabel = curChat
            ? (curChat.name ? curChat.name : curChat.id.slice(0, 10))
            : (tg.targetId ? (tg.targetId.length > 14 ? tg.targetId.slice(0, 6) + '…' + tg.targetId.slice(-4) : tg.targetId) : '')
          return h('div', { key: tg.id, style: boxStyle },
            h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', cursor: 'pointer' }, onClick: function () { toggleTarget(tg.id) } },
              h('span', { style: { width: 18, display: 'inline-block', color: '#8ab4ff' } }, open ? '▾' : '▸'),
              h('select', { className: 'qqs-inp', style: { ...inputStyle, width: 92 }, value: tg.scope === 'c2c' ? 'c2c' : 'group', onClick: function (e) { e.stopPropagation() }, onChange: function (e) { updTarget(ti, { scope: e.target.value, targetId: '' }) } },
                h('option', { value: 'group' }, '发给群'),
                h('option', { value: 'c2c' }, '发给私聊')),
              h('span', { style: { fontSize: 12, color: '#888' } }, scopeTag + ' · ' + taskN + ' 个时刻'),
              curLabel ? h('span', { style: { fontSize: 12, color: '#8ab4ff', fontWeight: 600 } }, '『' + curLabel + '』') : h('span', { style: { fontSize: 12, color: '#ffa94d' } }, '(未选聊天)'),
              h('button', { className: 'qqs-btn', style: { marginLeft: 'auto', padding: '2px 8px', fontSize: 12 }, onClick: function (e) { e.stopPropagation(); rmTarget(tg.id) } }, '删除')),
            open ? h('div', { style: { marginTop: 6 } },
              h('label', { style: labelStyle }, '选聊天对象(她见过的,显示昵称;不用抄任何号码): ',
                h('select', { className: 'qqs-inp', style: { ...inputStyle, width: '100%', maxWidth: 420 }, value: '', onChange: function (e) { if (e.target.value) { var pick = JSON.parse(e.target.value); updTarget(ti, { targetId: pick.id, scope: pick.scope, name: pick.name || tg.name || '' }) } } },
                  h('option', { value: '' }, '— 从最近聊天里选 —'),
                  chatOptions(tg.scope).map(function (c) {
                    var nm = c.name || c.id.slice(0, 10)
                    var tip = c.scope === 'c2c' ? (c.name ? c.name + ' (私聊)' : '私聊 ' + c.id.slice(0, 8)) : ('群 · 最近发言: ' + (c.name || '?') + ' (' + c.count + ' 条)')
                    return h('option', { key: c.scope + ':' + c.id, value: JSON.stringify({ id: c.id, scope: c.scope, name: c.name || '' }) }, tip)
                  }))),
              h('label', { style: labelStyle }, '备注名(可选,帮你认这个群/人): ',
                h('input', { className: 'qqs-inp', style: wideStyle, value: sv(tg.name), placeholder: '例:老家的群 / 老板', onChange: function (e) { updTarget(ti, { name: e.target.value }) } })),
              h('div', { style: { fontSize: 11, color: '#777', margin: '2px 0 6px' } }, '已选 ID: ' + (tg.targetId || '(未选)') + ' (平台内部编号,不用管它)'),
              (tg.tasks || []).map(function (tt, ji) {
                return h('div', { key: tt.id, style: { borderTop: '1px solid #8882', marginTop: 6, paddingTop: 6 } },
                  h('label', { style: labelStyle },
                    h('input', { className: 'qqs-inp', type: 'checkbox', checked: !!tt.enabled, onChange: function (e) { updTaskOf(ti, ji, { enabled: e.target.checked }) } }),
                    ' 每天 ',
                    h('input', { className: 'qqs-inp', style: { ...inputStyle, width: 58 }, value: sv(tt.time), placeholder: '09:00', onChange: function (e) { updTaskOf(ti, ji, { time: e.target.value }) } }),
                    ' 点 主动说一句'),
                  h('label', { style: labelStyle }, ' 方向(可留空=自由发挥): ',
                    h('input', { className: 'qqs-inp', style: wideStyle, value: sv(tt.prompt), placeholder: '例:早上好,提醒大家吃早饭', onChange: function (e) { updTaskOf(ti, ji, { prompt: e.target.value }) } }),
                    ' ',
                    h('button', { className: 'qqs-btn', style: { padding: '2px 8px', fontSize: 12 }, onClick: function () { rmTaskOf(ti, tt.id) } }, '删除')))
              }),
              h('button', { className: 'qqs-btn', style: { marginTop: 6, padding: '2px 10px', fontSize: 12 }, onClick: function () { addTaskOf(ti) } }, '+ 这个目标再加一个时刻'))
            : null)
        }),
        h('button', { className: 'qqs-btn', onClick: addTarget }, '+ 添加一个目标(群/私聊)'),
        h('div', { style: { margin: '8px 0' } },
          h('button', { className: 'qqs-btn', style: { marginRight: 8 }, onClick: save }, '保存定时唤醒'),
          h('button', { className: 'qqs-btn', onClick: load }, '放弃修改')),
        msg ? h('p', { style: { fontSize: 13, color: '#2f9e44' } }, msg) : null)
    }

    function TimersPage(props) {
      // 多账号: 定时任务按当前账号 schedDir(={cwd}/.qqbot)
      var _tmSD = props && props.acct && props.acct.schedDir ? String(props.acct.schedDir) : ''
      var _tmQ = _tmSD ? '?schedDir=' + encodeURIComponent(_tmSD) : ''
      var [jobs, setJobs] = useState(null)
      var [msg, setMsg] = useState('')
      var [busyId, setBusyId] = useState('')
      function load() {
        fetch(API_TIMERS + _tmQ).then(function (r) { return r.json() }).then(function (d) {
          if (d && Array.isArray(d.jobs)) setJobs(d.jobs.slice().reverse())
          else setMsg('读取失败: ' + JSON.stringify(d))
        }).catch(function (e) { setMsg('读取异常: ' + e.message) })
      }
      useEffect(function () { load() }, [])
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
      function who(job) { return (job.scope === 'c2c' ? '私聊' : '群聊') + ' · ' + String(job.peerId || '').slice(0, 8) }
      function chip(kind) {
        return h('span', { style: { fontSize: 11, padding: '1px 8px', borderRadius: 999, color: '#fff', background: kind === 'daily' ? '#2f9e44' : '#4d7cfe', whiteSpace: 'nowrap' } },
          kind === 'daily' ? '每天' : '一次性')
      }
      return h('div', { style: { maxWidth: 760 } },
        h('h2', null, '定时任务'),
        h('div', { style: { ...sectionTitle, marginTop: 4 } }, '① 定时唤醒(每天到点,让她主动去群/私聊开口)'),
        h('p', { style: { fontSize: 12, color: '#888' } }, '每个群/人一组,下面可加多个时刻。到点她以自己身份主动说 1~3 句(不@人、不带图);不用记号码——机器人会自动记住聊过的群和人,点「选聊天对象」挑一个即可(填 QQ 号没用,平台只认她视角的编号)。改完记得点「保存定时唤醒」。'),
        h(WakeEditor, { acct: props.acct }),
        h('div', { style: { ...sectionTitle, marginTop: 18, paddingTop: 10, borderTop: '1px solid #8882' } }, '② 她答应你的定时提醒(一次性/每天,在 QQ 里说一声就能建)'),
        h('p', { style: { fontSize: 12, color: '#888' } }, '这些是机器人在 QQ 里应你要求安排的提醒(比如"30秒后提醒我""每天早上9点提醒我")。新建直接去 QQ 里跟它说,这里只管看和开关/删除。一次性任务到点触发后自动消失;连续几次找不到会话的任务会自动停用,在这里重新打开即可。'),
        jobs === null ? h('p', null, '加载中…') : null,
        jobs !== null && jobs.length === 0 ? h('p', { style: { color: '#888', padding: 14, textAlign: 'center' } }, '还没有这类提醒。去 QQ 群/私聊里让机器人安排一个,它就会出现在这里。') : null,
        (jobs || []).map(function (j) {
          var disabled = busyId === j.id
          return h('div', { key: j.id, style: { border: '1px solid ' + (j.enabled ? '#8883' : '#ffa94d66'), borderRadius: 10, padding: '8px 12px', margin: '8px 0', opacity: j.enabled ? 1 : 0.72 } },
            h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
              chip(j.kind),
              h('span', { style: { fontWeight: 600 } }, fmtWhen(j)),
              h('span', { style: { fontSize: 12, color: '#888', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 150 } }, who(j)),
              h('span', { style: { flex: 1 } }),
              h('label', { style: { fontSize: 13, whiteSpace: 'nowrap', color: j.enabled ? '#8ab4ff' : '#ffa94d' } },
                h('input', { className: 'qqs-cb', type: 'checkbox', checked: !!j.enabled, disabled: disabled, onChange: function (e) { act(j, { enabled: e.target.checked }, e.target.checked ? '已启用' : '已停用') } }),
                ' ' + (j.enabled ? '启用中' : '已停用')),
              h('button', { className: 'qqs-btn', disabled: disabled, style: { padding: '2px 10px', fontSize: 12 }, onClick: function () { if (window.confirm('删除这条定时任务?')) act(j, {}, '已删除') } }, '删除')),
            j.prompt ? h('div', { style: { fontSize: 13, color: '#cfd3dc', background: '#ffffff0a', border: '1px solid #ffffff14', borderRadius: 8, padding: '4px 8px', marginTop: 6, whiteSpace: 'pre-wrap', wordBreak: 'break-all' } }, j.prompt) : null)
        }),
        msg ? h('p', { style: { fontSize: 13, color: '#2f9e44' } }, msg) : null,
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
    var PRESET_HINT = '想改人设：点预设卡片「打开文件夹」，编辑里面 agent.cordis.yml —— persona 插件 config.text 那段就是人设正文(改完保存并重启 dsh 生效)；preset.yml 的 name 是预设显示名。做新人格：选一个预设点「复制」，填「预设 id」(=文件夹名,字母/数字开头,可含 - _) 和「人设名」(中文随意)，保存后自动生成新预设文件夹。'
    function inputRow(label, node) {
      return h('label', { style: { display: 'block', margin: '5px 0', fontSize: 13 } }, label, node)
    }
    function AccountsPage(props) {
      var [insts, setInsts] = useState(null)
      var [presets, setPresets] = useState([])
      var [root, setRoot] = useState('')
      var [msg, setMsg] = useState('')
      var [busy, setBusy] = useState('')
      var [bind, setBind] = useState(null) // {id,url,status,error,iframeUrl}
      var [copy, setCopy] = useState(null) // 复制弹层: {sourceId}
      var [copyId, setCopyId] = useState('')
      var [copyName, setCopyName] = useState('')
      var pollRef = React.useRef(null)
      function load(quiet) {
        Promise.all([
          fetch(API_ACCOUNTS).then(function (r) { return r.json() }).catch(function () { return {} }),
          fetch(API_PRESETS).then(function (r) { return r.json() }).catch(function () { return {} }),
        ]).then(function (rs) {
          var a = rs[0] || {}
          if (Array.isArray(a.instances)) setInsts(a.instances)
          var p = rs[1] || {}
          if (Array.isArray(p.presets)) { setPresets(p.presets); if (p.root) setRoot(p.root) }
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
        var know = presets.every(function (p) { return p.hasChannelTools === true || p.hasChannelTools === false })
        var only = know ? presets.filter(function (p) { return p.hasChannelTools }) : presets
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
        var list = (insts || []).filter(function (x) { return x.id && (x.appId || x.appSecret || !x._new || x._bound) })
        // 空账号(全空且没绑定)不保存; 全新手动号若两凭据都空则提示
        var blanks = list.filter(function (x) { return !x.appSecret && !x._bound })
        if (blanks.length && !window.confirm('有 ' + blanks.length + ' 个账号没填 appSecret(不填的会被保存为只有骨架的实例, 可能启动就弹扫码)。继续?')) { setBusy(''); return }
        // 保存兜底: preset 仍为空的账号自动填第一个候选(防 effect 未触发/用户未手动选导致保存丢 preset)
        var knowNow = presets.length > 0 && presets.every(function (p) { return p.hasChannelTools === true || p.hasChannelTools === false })
        var candNow = knowNow ? presets.filter(function (p) { return p.hasChannelTools }) : presets
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
      var st = { width: '100%', padding: '5px 8px', boxSizing: 'border-box' }
      return h('div', { style: { maxWidth: 860 } },
        h('h2', null, '账号与预设'),
        h('p', { style: { fontSize: 12, color: '#888' } }, '一个 QQ 机器人 = 一个账号实例(AppID/AppSecret)。想同时开几个机器人就加几个实例，每个可以配不同的 agent 预设(人格)与工作目录(各人各数据,不串)。⚠️ appSecret 会明文存在本机 cordis.patch.yml(改前自动备份 .bak)，别把配置文件传上网。'),
        h('div', { style: sectionTitle }, '① 机器人账号(改完点保存, 重启生效)'),
        (insts === null ? h('p', null, '加载中…') : null),
        (insts || []).map(function (it, i) {
          // 账号可选预设: 有 QQ 工具的优先。容错: host 若还没返回 hasChannelTools(旧版未重启), 则不锁死、照常全列, 保证能选能填;
          // 一旦 host 给全了该字段, 就只列带 QQ 工具(不带行的选了在 QQ 跑不起来)。
          var knowChannel = presets.length > 0 && presets.every(function (p) { return p.hasChannelTools === true || p.hasChannelTools === false })
          var usable = knowChannel ? presets.filter(function (p) { return p.hasChannelTools }) : presets.slice()
          var selInvalid = it.preset && !usable.some(function (p) { return p.id === it.preset })
          var opts = usable.map(function (p) { return { id: p.id, label: p.name + ' (' + p.id + ')' } })
          if (selInvalid) opts.unshift({ id: it.preset, label: '⚠️ ' + it.preset + '(不带QQ工具, 无法在QQ用)' })
          return h('div', { key: it.id, style: { border: '1px solid ' + (it.disabled ? '#ffa94d66' : '#00000026'), borderRadius: 10, padding: '8px 12px', margin: '8px 0', background: 'rgba(255,255,255,.5)' } },
            h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
              h('span', { style: { fontWeight: 800, color: '#171a21' } }, it._bound ? '📱 扫码绑定' : (it._new ? '🆕 新账号' : '🤖 账号')),
              h('input', { className: 'qqs-inp', style: Object.assign({ width: 170 }, st), value: it.id, disabled: !it._new && !it._bound, onChange: function (e) { upd(i, { id: e.target.value }) }, placeholder: '实例 id(如 im-qqbot-2)' }),
              h('label', { style: { fontSize: 13, whiteSpace: 'nowrap' } },
                h('input', { className: 'qqs-cb', type: 'checkbox', checked: !it.disabled, onChange: function (e) { upd(i, { disabled: !e.target.checked }) } }), ' 启用'),
              h('button', { className: 'qqs-btn', onClick: function () { removeInst(i) }, style: { marginLeft: 'auto' } }, '删除')),
            inputRow('AppID: ', h('input', { className: 'qqs-inp', style: Object.assign({ width: 220 }, st), value: it.appId || '', onChange: function (e) { upd(i, { appId: e.target.value }) }, placeholder: '如 1905515836' })),
            inputRow('AppSecret: ', h('input', { className: 'qqs-inp', type: 'password', style: Object.assign({ width: 320 }, st), value: it.appSecret || '', onChange: function (e) { upd(i, { appSecret: e.target.value }) }, placeholder: '扫码绑定会自动填; 也可手动填(两个都要填全才不弹码)' })),
            inputRow('Agent 预设(人格): ', (function () { if (usable.length === 0 && !selInvalid) {
                return h('span', { className: 'qqs-inp', style: { display: 'inline-block', verticalAlign: 'middle', padding: '5px 10px', fontSize: 12, color: '#e8590c', background: '#fff5f0', borderRadius: 6 } }, '⚠️ 还没有可用的 Agent 预设——请在下方②复制一个(如 whale-girl / whitegirl), 复制会自动带 QQ 工具。')
              } return h('select', { className: 'qqs-inp', style: { width: 320, padding: '4px 8px' }, value: it.preset || '', onChange: function (e) { upd(i, { preset: e.target.value }) } }, opts.map(function (o) { return h('option', { key: o.id, value: o.id, style: selInvalid && o.id === it.preset ? { color: '#e03131' } : null }, o.label) })) })()),
            inputRow('工作目录(各账号数据放这, 留空=默认): ', h('input', { className: 'qqs-inp', style: Object.assign({ width: '90%' }, st), value: it.cwd || '', onChange: function (e) { upd(i, { cwd: e.target.value }) }, placeholder: '如 D:\\bots\\二号机' })))
        }),
        h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', margin: '8px 0' } },
          h('button', { className: 'qqs-btn', onClick: addBlank }, '+ 添加账号(手动填凭据)'),
          h('button', { className: 'qqs-btn', onClick: startBind, style: { borderColor: '#b197fc99', color: '#171a21' } }, '📱 扫码绑定新机器人(推荐)'),
          h('span', { style: { flex: 1 } }),
          h('button', { className: 'qqs-btn', onClick: save, disabled: busy === 'save' }, '保存账号配置'),
          h('button', { className: 'qqs-btn', onClick: function () { load() } }, '重新读取')),
        h('div', { style: { ...sectionTitle, marginTop: 16, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' } },
          '② Agent 预设(人格库)',
          h('button', { className: 'qqs-btn', style: { fontSize: 12, padding: '2px 10px', borderColor: '#2b8a3e99', color: '#171a21' }, onClick: function () { setCopy({ fromStandard: true, sourceId: 'standard' }); setCopyId(''); setCopyName('') } }, '➕ 从标准模式新建(带QQ工具)')),
        h('p', { style: { fontSize: 12, color: '#888' } }, PRESET_HINT),
        (presets.filter(function (p) { return !p.hasChannelTools }).length > 0
          ? h('p', { style: { fontSize: 12, color: '#e8590c', background: '#fff5f0', borderRadius: 6, padding: '6px 10px' } }, '💡 选一个预设点「复制」生成的副本会自动带上 QQ 工具(send_media/发图等), 之后就能在①账号里给机器人选用了。复制源无所谓, 只要是能跑的人格。')
          : null),
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(190px,1fr))', gap: 10, margin: '8px 0' } },
          presets.map(function (p) {
            return h('div', { key: p.id, style: { border: '1px solid #00000026', borderRadius: 10, padding: '10px 12px', background: 'rgba(255,255,255,.5)' } },
              h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
                h('span', { style: { fontWeight: 800, color: '#171a21' } }, p.name),
                h('span', { style: { fontSize: 10, padding: '1px 6px', borderRadius: 8, color: '#fff', background: p.hasChannelTools ? '#2b8a3e' : '#e8590c' } }, p.hasChannelTools ? 'QQ可用' : '无QQ工具')),
              h('div', { style: { fontSize: 12, color: '#666', margin: '4px 0' } }, 'id=' + p.id),
              h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
                h('button', { className: 'qqs-btn', style: { padding: '2px 10px', fontSize: 12 }, onClick: function () { setCopy({ sourceId: p.id }); setCopyId(''); setCopyName('') } }, '复制'),
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

var QQS_CSS = ".qqs-btn{font:inherit;color:inherit;background:linear-gradient(180deg,#ffffff22,#ffffff0f);border:1px solid #ffffff30;border-radius:9px;padding:5px 13px;cursor:pointer;transition:all .15s}.qqs-btn:hover{background:#ffffff32;border-color:#ffffff55}.qqs-btn:active{transform:translateY(1px)}.qqs-inp,.qqs-area{font:inherit;color:#f0f0f0;background:#00000088;border:1px solid #ffffff2e;border-radius:9px;padding:5px 10px;outline:none;transition:border-color .15s}.qqs-inp::placeholder,.qqs-area::placeholder{color:#ffffff66}.qqs-inp:focus,.qqs-area:focus{border-color:#5b9dff;box-shadow:0 0 0 2px #5b9dff44}.qqs-cb{accent-color:#5b9dff;width:15px;height:15px}.qqs-card{transition:box-shadow .15s,border-color .15s}.qqs-card:hover{box-shadow:0 2px 10px #0008}.qqs-panel{background:linear-gradient(180deg,#ffffff0a,#ffffff03);border:1px solid #ffffff22;border-radius:16px;padding:16px;box-shadow:0 10px 34px #0004}.qqs-toolbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;background:#ffffff0a;border:1px solid #ffffff16;border-radius:12px;padding:8px 10px;margin-bottom:10px}.qqs-modal{background:#22252e;color:#e8e8e8}"
    function ensureCss() { try { if (!document.getElementById('qqs-css')) { var st = document.createElement('style'); st.id = 'qqs-css'; st.textContent = QQS_CSS; document.head.appendChild(st) } } catch (e) {} }

    function apply(ctx) {
      ensureCss()
      var slots = ctx.slots
      if (!slots) { console.warn('[qqbot-settings] slots unavailable'); return }
      slots.inject('settings.section', function () {
        return slots.register(
          { name: 'settings.section', id: 'qqbot', order: 32, label: 'QQ 机器人' },
          function (props) { return h(QqbotHome, { close: props && props.close }) })
      })
    }

    exports.inject = ['slots']
    exports.apply = apply
    return module.exports
  }
})
