/* ============================================================
   《长征：万水千山》新手引导
   一份内容，供主入口 / 平面行军 / 立体长卷共用。
   零依赖、零网络请求；所有样式在运行时注入，不挑页面。
   ============================================================ */
(function () {
  'use strict';
  if (window.Tutorial) return;

  var VERSION = '41';
  var SEEN_KEY = 'cwqs_tutorial_seen_v1';
  var STEPS = [
    {
      kicker: '01 · 这一程',
      title: '带着一支队伍，走到吴起镇',
      lead: '你从于都河出发，一格一格往北走。每一格都要做选择，兵、粮、时、民会跟着变化。',
      points: [
        '目标不是“打赢”，而是把尽可能多的人带到终点。',
        '木牌上刻下的名字，是这趟路唯一带得走的东西。',
        '失败不写 Game Over，写“下一程”；队伍会重新接上。'
      ],
      art: '<div class="tz-route">' +
        '<span class="tz-route-line"></span>' +
        '<i class="tz-dot done" style="left:6%;top:70%"></i>' +
        '<i class="tz-dot done" style="left:29%;top:55%"></i>' +
        '<i class="tz-dot done" style="left:52%;top:63%"></i>' +
        '<i class="tz-dot next" style="left:73%;top:38%"><b>下一站</b></i>' +
        '<i class="tz-dot goal" style="left:92%;top:21%"></i>' +
        '<span class="tz-place" style="left:5%;top:82%">于都河</span>' +
        '<span class="tz-place" style="left:66%;top:52%">雪山草地</span>' +
        '<span class="tz-place" style="left:83%;top:32%">吴起镇</span>' +
        '</div>'
    },
    {
      kicker: '02 · 地图与操作',
      title: '两种看法，一套进度',
      lead: '平面图看全局，立体长卷走进现场。两边随时切换，存档、资源、木牌和史料完全互通。',
      points: [
        '<b>平面行军</b>：按住拖动地图，滚轮或双指缩放；点「远望全图」看整条路线。',
        '<b>立体长卷</b>：点金色地名或「下一站」行军；手机左下方向键移动、右下升降、双指缩放。',
        '3D 的「视图工具」里还有视角、漫游、画质、暂停和导出画面；2D 左下「须知」章可随时重看规则。'
      ],
      art: '<div class="tz-modes">' +
        '<div class="tz-mode"><span class="tz-mode-tag">MODE 01</span><b>平面行军</b><small>拖动 · 滚轮 / 双指缩放<br>点红圈或「下一站」</small></div>' +
        '<div class="tz-mode dark"><span class="tz-mode-tag">MODE 02</span><b>立体长卷</b><small>左下方向 · 右下升降<br>双指缩放 · 点金色地名</small></div>' +
        '</div>'
    },
    {
      kicker: '03 · 四条资源',
      title: '兵、粮、时、民，一起算账',
      lead: '右上角（手机在顶部）这四条，是你每一次抉择的全部依据。',
      points: [
        '<b>兵</b>：还能走的同伴。归零就进入“下一程”。',
        '<b>粮</b>：每走一格 -1；断粮会多饿倒人，民心高时百姓会接济。',
        '<b>时</b>：追兵窗口。每走一格 -1；归零后下一格折损翻倍。',
        '<b>民</b>：沿途人心。低于 20，民族地区的向导与借粮选项会锁死。'
      ],
      art: '<div class="tz-res">' +
        '<div><span>兵</span><b>88</b><i style="width:72%"></i></div>' +
        '<div><span>粮</span><b>10</b><i style="width:45%"></i></div>' +
        '<div><span>时</span><b>5</b><i style="width:34%"></i></div>' +
        '<div><span>民</span><b>50</b><i style="width:58%"></i></div>' +
        '</div>'
    },
    {
      kicker: '04 · 行军与事件',
      title: '亮起来的那一格，才是能走的路',
      lead: '地图上呼吸的红圈、写着「▸ 下一站」的格子，就是眼下能去的地方。视野外会亮起红箭头，点它也能过去。',
      points: [
        '<b>明事件</b>：图标写清类型，可以先判断要不要走。',
        '<b>暗事件</b>：只显示问号，走到才揭晓。',
        '<b>动事件</b>：行进途中随机触发，敌袭、疫病、断水、收容队等十类。',
        '不相邻的格子点不动；云里没探明的路，也先看不见。'
      ],
      art: '<div class="tz-events">' +
        '<span class="tz-event light"><b>明</b>图标可见</span>' +
        '<span class="tz-event dark"><b>暗</b>只露问号</span>' +
        '<span class="tz-event move"><b>动</b>途中触发</span>' +
        '<div class="tz-next-demo">◉ <b>下一站</b><span>点它就走</span></div>' +
        '</div>'
    },
    {
      kicker: '05 · 选择与结算',
      title: '代价，按下去才看得见',
      lead: '选项上故意不标价。先按你的判断选，按完不跳转，会原地把真实增减亮给你看。',
      points: [
        '选择你按下的那一条，和没选的那几条，会同时显示增减。',
        '有些账会延迟：抢粮当场不掉民，过两三格才收。',
        '违纪可以选、当场有甜头；标记累积到 3，一定会收账。',
        '大关卡打下来，粮、时、兵三样只能带一样。'
      ],
      art: '<div class="tz-choice">' +
        '<div class="tz-opt chosen"><span>把口粮先紧着队伍</span><em>粮 +6</em><em class="down">兵 -2</em></div>' +
        '<div class="tz-opt"><span>连夜赶路，甩开追兵</span><em>时 +2</em></div>' +
        '<p>结算会在原地停几秒，点任意处可提前继续。</p>' +
        '</div>'
    },
    {
      kicker: '06 · 卡牌与战友',
      title: '手法卡主动用，身边人被动挡',
      lead: '底部两条托盘不是装饰：手法卡在抉择里附一张，战友会在硬仗和冻饿时自动向前站一步。',
      points: [
        '<b>手法卡</b>：一局一张，点开抉择时可附上，减少折损。',
        '<b>战友卡</b>：每人最多替你挡一次作战或冻饿，挡不住违纪的账。',
        '<b>道具</b>：在行囊里查看，关键格会派上用场。',
        '会救人的关卡可以把活下来的人编进队伍，战友一起走到终点。'
      ],
      art: '<div class="tz-cards">' +
        '<div class="tz-card-mini"><span>手法卡</span><b>声东击西</b><small>抉择时附一张</small></div>' +
        '<div class="tz-card-mini comrade"><span>身边人</span><b>老范</b><small>替你挡一次</small></div>' +
        '<div class="tz-card-mini item"><span>行囊</span><b>半截皮带</b><small>关键格可用</small></div>' +
        '</div>'
    },
    {
      kicker: '07 · 记录',
      title: '木牌、名单墙、史料与记忆',
      lead: '主界面只留核心操作；这些记录收在「功能 / 菜单」里，随时可以翻。',
      points: [
        '<b>木牌</b>：本局走过的地名、牺牲的名字与留白。',
        '<b>名单墙</b>：走完一程后永久挂上，正名区和警示区分开。',
        '<b>史料</b>：关卡结算解锁词条，A 权威 / R 回忆 / ? 待核实。',
        '<b>战友记忆</b>：他们记得你做过什么；行囊则收着卡牌和道具。'
      ],
      art: '<div class="tz-records">' +
        '<span><b>木牌</b><small>本局的名字</small></span>' +
        '<span><b>名单墙</b><small>永久留存</small></span>' +
        '<span><b>史料</b><small>逐条解锁</small></span>' +
        '<span><b>记忆</b><small>战友评说</small></span>' +
        '</div>'
    },
    {
      kicker: '08 · 存档与切换',
      title: '换设备、换地图，都能接着走',
      lead: '进度只存在本机浏览器，不上传。两套地图共用同一份存档；需要带走时用存档码。',
      points: [
        '顶栏的模式切换随时换图，当前节点和全部资源都会保留。',
        '「存档码」可以复制出去，换设备后粘贴回来接着走。',
        '「清空进度」会同时清掉名单墙、木牌和解锁史料，无法恢复。',
        '顶栏「功能 / 菜单」把记录、规则、存档收在一起；「主入口」回到双地图选择页并显示进度摘要。'
      ],
      art: '<div class="tz-save">' +
        '<div class="tz-save-box"><span>第 3 程 · 行至 娄山关</span><b>兵 76 · 粮 8 · 时 4 · 民 46</b><small>同一份存档 · 随时切换</small></div>' +
        '<div class="tz-code">CWQS-••••-••••-••••</div>' +
        '</div>'
    },
    {
      kicker: '09 · 结局',
      title: '走到最后，看谁还在',
      lead: '终点不是一句胜利。你把名字一个一个念出来，牌上留下的空白也算答案。',
      points: [
        '<b>下一程</b>：作战、冻饿或掉队后，收容队把你接回去，名字不清零。',
        '<b>多行不义必自毙</b>：违纪标记收账，木牌挂进警示区。',
        '<b>终点</b>：清点兵、粮、民、木牌与解锁史料，可以导出这一程。',
        '现在就开始：先选一张地图，剩下的路上再学。'
      ],
      art: '<div class="tz-end">' +
        '<span class="tz-end-seal">万水千山</span>' +
        '<p>“念到最后一个，他停住了。”</p>' +
        '<small>木牌会记住你带出来的人，也记住没带出来的人。</small>' +
        '</div>',
      final: true
    }
  ];

  var CSS = [
    '.tz-backdrop{position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(6,7,5,.82);backdrop-filter:blur(9px);-webkit-backdrop-filter:blur(9px);font-family:"Songti SC","STSong","Noto Serif SC","SimSun",serif;color:#efe6d2}',
    '.tz-card{position:relative;display:flex;flex-direction:column;width:min(980px,100%);max-height:min(760px,calc(100dvh - 48px));overflow:hidden;border:1px solid rgba(207,190,158,.32);border-radius:8px;background:linear-gradient(145deg,#211e18 0%,#171510 56%,#241b14 100%);box-shadow:0 36px 100px rgba(0,0,0,.7)}',
    '.tz-card::before{content:"";position:absolute;inset:0;pointer-events:none;background:repeating-linear-gradient(0deg,rgba(255,255,255,.016) 0 1px,transparent 1px 4px),radial-gradient(90% 70% at 75% 0%,rgba(150,62,46,.16),transparent 62%)}',
    '.tz-head{position:relative;z-index:1;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:16px 20px 10px;border-bottom:1px solid rgba(207,190,158,.12)}',
    '.tz-head-l{display:flex;align-items:center;gap:12px;min-width:0}.tz-seal{display:grid;place-items:center;width:38px;height:38px;flex:0 0 auto;background:#963c2e;color:#f7eedb;font-size:11px;letter-spacing:2px;writing-mode:vertical-rl;text-orientation:upright;box-shadow:inset 0 0 0 2px rgba(255,238,210,.15)}',
    '.tz-head b{display:block;font-size:15px;font-weight:500;letter-spacing:3px;color:#f2e6ce}.tz-head small{display:block;margin-top:3px;font-family:var(--sans,"PingFang SC","Microsoft YaHei",sans-serif);font-size:9.5px;letter-spacing:1.6px;color:#938974}',
    '.tz-close{flex:0 0 auto;min-height:36px;padding:0 12px;border:1px solid rgba(207,190,158,.24);border-radius:999px;background:transparent;color:#b9ad96;font:500 11px/1 var(--sans,"PingFang SC","Microsoft YaHei",sans-serif);letter-spacing:1px;cursor:pointer}.tz-close:hover{color:#fff2d7;border-color:rgba(207,190,158,.5)}',
    '.tz-progress{position:relative;z-index:1;height:2px;background:rgba(255,255,255,.06)}.tz-progress i{display:block;height:100%;background:linear-gradient(90deg,#963c2e,#d3ae68);transition:width .3s ease}',
    '.tz-body{position:relative;z-index:1;flex:1 1 auto;display:grid;grid-template-columns:minmax(260px,.92fr) minmax(0,1.08fr);gap:28px;align-items:center;padding:26px 30px 22px;overflow:auto}',
    '.tz-art{display:grid;place-items:center;min-height:260px;padding:18px;border:1px solid rgba(207,190,158,.14);border-radius:4px;background:rgba(255,250,238,.025);overflow:hidden}',
    '.tz-copy{min-width:0}.tz-kicker{margin:0 0 9px;font:600 10px/1.4 var(--sans,"PingFang SC","Microsoft YaHei",sans-serif);letter-spacing:3px;color:#b99a62}.tz-copy h2{margin:0;font-size:clamp(25px,3vw,37px);line-height:1.28;letter-spacing:2px;font-weight:500;color:#f4ead5}.tz-copy .lead{margin:14px 0 0;font-size:14.5px;line-height:1.95;color:#cfc2a9}',
    '.tz-points{display:grid;gap:9px;margin:18px 0 0;padding:0;list-style:none}.tz-points li{position:relative;padding-left:17px;font-family:var(--sans,"PingFang SC","Microsoft YaHei",sans-serif);font-size:12.5px;line-height:1.75;color:#b7aa92}.tz-points li::before{content:"";position:absolute;left:0;top:.68em;width:6px;height:6px;border:1px solid #b6533e;transform:rotate(45deg)}.tz-points b{color:#eadcc0;font-weight:600}',
    '.tz-foot{position:relative;z-index:1;display:flex;align-items:center;justify-content:space-between;gap:14px;padding:13px 20px 16px;border-top:1px solid rgba(207,190,158,.12);background:rgba(8,8,6,.24)}',
    '.tz-btn{min-height:42px;padding:0 17px;border:1px solid rgba(207,190,158,.26);border-radius:3px;background:rgba(255,255,255,.035);color:#d9cab0;font:500 12px/1 var(--sans,"PingFang SC","Microsoft YaHei",sans-serif);letter-spacing:1.5px;cursor:pointer}.tz-btn:hover{border-color:rgba(207,190,158,.55);color:#fff2d8}.tz-btn.primary{border-color:#b6533e;background:linear-gradient(#a34838,#7f3025);color:#fff3de;box-shadow:0 8px 24px rgba(80,24,17,.24)}.tz-btn.primary:hover{background:linear-gradient(#b6533e,#8d3528)}.tz-btn.ghost{background:transparent}.tz-btn:disabled{opacity:.28;cursor:default}',
    '.tz-dots{display:flex;align-items:center;gap:6px}.tz-dots i{width:6px;height:6px;border-radius:50%;background:rgba(207,190,158,.24);transition:.2s}.tz-dots i.on{width:20px;border-radius:999px;background:#c5a15c}',
    '.tz-route{position:relative;width:100%;height:100%;min-height:250px;background:radial-gradient(ellipse at 55% 50%,rgba(197,161,92,.08),transparent 65%)}.tz-route-line{position:absolute;left:6%;right:9%;top:26%;height:48%;border-left:2px dashed rgba(182,83,62,.6);border-bottom:2px dashed rgba(182,83,62,.6);transform:skewY(-16deg);border-radius:0 0 0 40%}',
    '.tz-dot{position:absolute;width:12px;height:12px;border-radius:50%;background:#6a6152;border:2px solid #d8c9ab;transform:translate(-50%,-50%)}.tz-dot.done{background:#963c2e}.tz-dot.next{width:22px;height:22px;background:radial-gradient(circle at 45% 38%,#f9e8b7,#c5a15c);border-color:#fff0c8;box-shadow:0 0 0 7px rgba(197,161,92,.18),0 0 28px rgba(197,161,92,.4)}.tz-dot.next b{position:absolute;left:50%;bottom:28px;transform:translateX(-50%);white-space:nowrap;padding:3px 7px;border-radius:999px;background:#963c2e;color:#fff0d6;font:600 10px/1.2 var(--sans,"PingFang SC","Microsoft YaHei",sans-serif);letter-spacing:1px}.tz-dot.goal{width:17px;height:17px;background:#4b7157;border-color:#dfe8d7}',
    '.tz-place{position:absolute;transform:translate(-50%,0);font-family:var(--sans,"PingFang SC","Microsoft YaHei",sans-serif);font-size:10px;letter-spacing:1px;color:#9f937d;white-space:nowrap}',
    '.tz-modes{display:grid;gap:12px;width:100%}.tz-mode{position:relative;padding:18px;border:1px solid rgba(197,161,92,.28);border-radius:4px;background:linear-gradient(135deg,rgba(218,206,181,.13),rgba(255,255,255,.02))}.tz-mode.dark{background:linear-gradient(135deg,rgba(74,90,89,.24),rgba(20,19,15,.2));border-color:rgba(124,154,152,.3)}.tz-mode-tag{display:block;font:600 8.5px/1 var(--sans,"PingFang SC","Microsoft YaHei",sans-serif);letter-spacing:2.4px;color:#8f8572}.tz-mode b{display:block;margin-top:7px;font-size:23px;letter-spacing:3px;font-weight:500;color:#f1e4c8}.tz-mode small{display:block;margin-top:9px;font-family:var(--sans,"PingFang SC","Microsoft YaHei",sans-serif);font-size:11.5px;line-height:1.8;color:#ab9f88}',
    '.tz-res{display:grid;grid-template-columns:1fr 1fr;gap:11px;width:100%}.tz-res div{display:grid;grid-template-columns:auto 1fr;gap:4px 9px;align-items:baseline;padding:14px 14px 12px;border:1px solid rgba(207,190,158,.16);background:rgba(255,255,255,.025)}.tz-res span{font-size:13px;color:#b9a98c}.tz-res b{font-size:25px;font-weight:500;text-align:right;color:#f1e5cc}.tz-res i{grid-column:1/-1;height:4px;background:linear-gradient(90deg,#963c2e,#c5a15c);border-radius:2px}.tz-res div:nth-child(2) i{background:linear-gradient(90deg,#a5813a,#d7bd7c)}.tz-res div:nth-child(3) i{background:linear-gradient(90deg,#4a6f7c,#8fb0b6)}.tz-res div:nth-child(4) i{background:linear-gradient(90deg,#4d7a52,#9bb497)}',
    '.tz-events{display:grid;grid-template-columns:1fr 1fr;gap:10px;width:100%}.tz-event{display:flex;flex-direction:column;gap:5px;padding:14px;border:1px solid rgba(207,190,158,.16);background:rgba(255,255,255,.02);font-family:var(--sans,"PingFang SC","Microsoft YaHei",sans-serif);font-size:10.5px;color:#9f947e}.tz-event b{font-family:inherit;font-size:21px;color:#e9d7b5}.tz-event.light b{color:#d3b36f}.tz-event.dark b{color:#b8b4a7}.tz-event.move b{color:#c17b68}.tz-next-demo{grid-column:1/-1;display:flex;align-items:center;gap:9px;padding:14px;border:1px solid rgba(197,161,92,.38);background:rgba(197,161,92,.07);border-radius:999px;color:#e9d7b3;font-family:var(--sans,"PingFang SC","Microsoft YaHei",sans-serif);font-size:11px}.tz-next-demo b{font-size:12px;letter-spacing:1px}.tz-next-demo span{margin-left:auto;color:#9f947e}',
    '.tz-choice{display:grid;gap:10px;width:100%}.tz-opt{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:15px;border:1px solid rgba(207,190,158,.16);background:rgba(255,255,255,.02);font-family:var(--sans,"PingFang SC","Microsoft YaHei",sans-serif);font-size:11.5px;color:#c9bda6}.tz-opt.chosen{border-color:rgba(197,161,92,.48);background:rgba(197,161,92,.08)}.tz-opt em{flex:0 0 auto;font-style:normal;color:#9dc49c;font-size:11px}.tz-opt em.down{color:#df9588}.tz-choice p{margin:4px 0 0;font-family:var(--sans,"PingFang SC","Microsoft YaHei",sans-serif);font-size:10px;line-height:1.7;color:#827967}',
    '.tz-cards{display:grid;gap:10px;width:100%}.tz-card-mini{position:relative;padding:14px 16px;border:1px solid rgba(207,190,158,.16);border-left:3px solid #8c3b2e;background:rgba(255,255,255,.025)}.tz-card-mini span{display:block;font:600 8.5px/1 var(--sans,"PingFang SC","Microsoft YaHei",sans-serif);letter-spacing:2px;color:#8f8572}.tz-card-mini b{display:block;margin-top:6px;font-size:18px;letter-spacing:2px;font-weight:500;color:#f0e3c8}.tz-card-mini small{display:block;margin-top:4px;font-family:var(--sans,"PingFang SC","Microsoft YaHei",sans-serif);font-size:10.5px;color:#a29781}.tz-card-mini.comrade{border-left-color:#4d7a52}.tz-card-mini.item{border-left-color:#a5813a}',
    '.tz-records{display:grid;grid-template-columns:1fr 1fr;gap:9px;width:100%}.tz-records span{display:flex;flex-direction:column;gap:4px;padding:14px;border:1px solid rgba(207,190,158,.16);background:rgba(255,255,255,.02)}.tz-records b{font-size:16px;letter-spacing:2px;font-weight:500;color:#eadcc0}.tz-records small{font-family:var(--sans,"PingFang SC","Microsoft YaHei",sans-serif);font-size:10px;color:#968b76}',
    '.tz-save{display:grid;gap:12px;width:100%}.tz-save-box{padding:18px;border:1px solid rgba(207,190,158,.2);background:rgba(255,255,255,.025)}.tz-save-box span{display:block;font:600 10px/1.3 var(--sans,"PingFang SC","Microsoft YaHei",sans-serif);letter-spacing:1.6px;color:#b99a62}.tz-save-box b{display:block;margin-top:9px;font-size:22px;font-weight:500;letter-spacing:1px;color:#f0e4ca}.tz-save-box small{display:block;margin-top:8px;font-family:var(--sans,"PingFang SC","Microsoft YaHei",sans-serif);font-size:10.5px;color:#9e927c}.tz-code{padding:13px 15px;border:1px dashed rgba(207,190,158,.28);font-family:ui-monospace,Consolas,monospace;font-size:12px;letter-spacing:1.5px;color:#b7a98f;text-align:center}',
    '.tz-end{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;width:100%;text-align:center}.tz-end-seal{display:grid;place-items:center;width:82px;height:82px;border:1px solid rgba(255,238,210,.32);background:#963c2e;box-shadow:inset 0 0 0 4px rgba(255,236,207,.11),0 16px 40px rgba(0,0,0,.35);color:#f7eedb;font-size:15px;letter-spacing:3px;writing-mode:vertical-rl;text-orientation:upright}.tz-end p{margin:4px 0 0;font-size:16px;line-height:1.9;color:#e7d7ba}.tz-end small{font-family:var(--sans,"PingFang SC","Microsoft YaHei",sans-serif);font-size:11px;line-height:1.8;color:#9e927c}',
    '.tz-final-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}.tz-final-actions a{display:inline-flex;align-items:center;justify-content:center;min-height:40px;padding:0 14px;border:1px solid rgba(197,161,92,.36);border-radius:3px;color:#e9d5ae;text-decoration:none;font-family:var(--sans,"PingFang SC","Microsoft YaHei",sans-serif);font-size:11.5px;letter-spacing:1.2px}.tz-final-actions a:hover{background:rgba(197,161,92,.11);color:#fff3d8}',
    'body.tz-open{overflow:hidden}',
    '@media(max-width:760px){.tz-backdrop{padding:0}.tz-card{width:100%;height:100dvh;max-height:100dvh;border:0;border-radius:0}.tz-head{padding:12px 14px 9px}.tz-seal{width:32px;height:32px;font-size:9.5px}.tz-head b{font-size:12.5px;letter-spacing:2px}.tz-head small{font-size:8.5px}.tz-body{grid-template-columns:1fr;grid-template-rows:max-content max-content;align-content:start;gap:18px;align-items:start;padding:18px 18px 16px}.tz-art{min-height:176px;padding:12px}.tz-copy h2{font-size:clamp(24px,7vw,32px);letter-spacing:1.5px}.tz-copy .lead{font-size:13.5px;line-height:1.85}.tz-points{gap:7px;margin-top:14px}.tz-points li{font-size:11.8px;line-height:1.75}.tz-foot{padding:10px 14px calc(12px + env(safe-area-inset-bottom,0px))}.tz-btn{min-height:44px;padding:0 13px;font-size:11.5px}.tz-dots{display:none}.tz-route{min-height:165px}.tz-res b{font-size:21px}.tz-end-seal{width:68px;height:68px;font-size:12px}}',
    '@media(prefers-reduced-motion:reduce){.tz-progress i{transition:none}}'
  ].join('');

  var root = null, current = 0, opts = {}, lastFocus = null;

  function injectCSS() {
    if (document.getElementById('tz-style')) return;
    var st = document.createElement('style');
    st.id = 'tz-style';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  function seen() {
    try { return localStorage.getItem(SEEN_KEY) === VERSION; } catch (e) { return false; }
  }

  function markSeen() {
    try { localStorage.setItem(SEEN_KEY, VERSION); } catch (e) {}
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function modeLinks() {
    var at = opts.node ? '&node=' + encodeURIComponent(opts.node) : '';
    return '<div class="tz-final-actions">' +
      '<a href="map.html?v=' + VERSION + '&from=guide' + at + '">去平面行军</a>' +
      '<a href="route3d.html?v=' + VERSION + '&play=1&from=guide' + at + '">去立体长卷</a>' +
      '</div>';
  }

  function render() {
    if (!root) return;
    var s = STEPS[current];
    var pct = ((current + 1) / STEPS.length) * 100;
    var body = '<div class="tz-art">' + s.art + '</div>' +
      '<div class="tz-copy"><p class="tz-kicker">' + esc(s.kicker) + '</p>' +
      '<h2>' + s.title + '</h2><p class="lead">' + s.lead + '</p>' +
      '<ul class="tz-points">' + s.points.map(function (p) { return '<li>' + p + '</li>'; }).join('') + '</ul>' +
      (s.final && opts.from === 'start' ? modeLinks() : '') + '</div>';
    var dots = STEPS.map(function (_, i) {
      return '<i class="' + (i === current ? 'on' : '') + '"></i>';
    }).join('');
    var nextText = current === STEPS.length - 1 ? '完成引导' : (current === 0 ? '开始看' : '下一步');
    root.innerHTML =
      '<div class="tz-card" role="dialog" aria-modal="true" aria-label="新手引导">' +
        '<header class="tz-head"><div class="tz-head-l"><span class="tz-seal">长征</span>' +
          '<div><b>新手引导</b><small>第 ' + (current + 1) + ' / ' + STEPS.length + ' 步 · 全部玩法一览</small></div></div>' +
          '<button class="tz-close" type="button" data-close>跳过</button></header>' +
        '<div class="tz-progress"><i style="width:' + pct + '%"></i></div>' +
        '<main class="tz-body">' + body + '</main>' +
        '<footer class="tz-foot">' +
          '<button class="tz-btn ghost" type="button" data-prev' + (current === 0 ? ' disabled' : '') + '>上一步</button>' +
          '<div class="tz-dots" aria-hidden="true">' + dots + '</div>' +
          '<button class="tz-btn primary" type="button" data-next>' + nextText + '</button>' +
        '</footer>' +
      '</div>';

    root.querySelector('[data-close]').addEventListener('click', close);
    root.querySelector('[data-prev]').addEventListener('click', prev);
    root.querySelector('[data-next]').addEventListener('click', next);
    Array.prototype.forEach.call(root.querySelectorAll('.tz-final-actions a'), function (a) {
      a.addEventListener('click', markSeen);
    });
    var bodyEl = root.querySelector('.tz-body');
    if (bodyEl) bodyEl.scrollTop = 0;
  }

  function next() {
    if (current >= STEPS.length - 1) { markSeen(); close(); return; }
    current++; render();
  }

  function prev() {
    if (current <= 0) return;
    current--; render();
  }

  function onKey(ev) {
    if (!root) return;
    if (ev.key === 'Escape') close();
    else if (ev.key === 'ArrowRight') next();
    else if (ev.key === 'ArrowLeft') prev();
  }

  function open(options) {
    opts = options || {};
    injectCSS();
    if (root) { current = 0; render(); return; }
    lastFocus = document.activeElement;
    current = 0;
    root = document.createElement('div');
    root.className = 'tz-backdrop';
    root.addEventListener('click', function (ev) { if (ev.target === root) close(); });
    document.body.appendChild(root);
    document.body.classList.add('tz-open');
    document.addEventListener('keydown', onKey);
    render();
    var btn = root.querySelector('[data-next]');
    if (btn) btn.focus();
  }

  function close() {
    if (!root) return;
    markSeen();
    document.removeEventListener('keydown', onKey);
    document.body.classList.remove('tz-open');
    if (root.parentNode) root.parentNode.removeChild(root);
    root = null;
    if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) {} }
    lastFocus = null;
  }

  window.Tutorial = { open: open, close: close, seen: seen, markSeen: markSeen, version: VERSION };
})();
