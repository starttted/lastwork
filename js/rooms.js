/* ==========================================================================
   自习室查询页脚本：加载 rooms.json -> 动态生成筛选项 -> 组合筛选 + 排序 + 渲染
   依赖：jQuery、common.js
   ========================================================================== */
(function ($) {
  'use strict';

  var allRooms = [];        // JSON 中的原始数据
  var activeChip = 'all';   // 当前选中的快捷条件
  var $list = $('#roomList');
  var $summary = $('#resultSummary');
  var $alertHost = $('#alertHost');

  /* ---------------------------- 工具 ---------------------------- */

  // 取整数值并做边界保护，防止 JSON 中出现非法值
  function safeInt(v, def) {
    var n = parseInt(v, 10);
    return isNaN(n) ? def : n;
  }

  function matchChip(room, chip) {
    var rate = App.occupancyOf(room);
    switch (chip) {
      case 'available': return safeInt(room.available, 0) > 0;
      case 'socket':    return room.hasSocket === true;
      case 'quiet':     return safeInt(room.quietLevel, 0) >= 4;
      case 'ac':        return room.hasAC === true;
      default:          return true;
    }
  }

  function sortList(list, mode) {
    var arr = list.slice();
    arr.sort(function (a, b) {
      var ra = App.occupancyOf(a), rb = App.occupancyOf(b);
      switch (mode) {
        case 'rate-asc':  return ra - rb;
        case 'rate-desc': return rb - ra;
        case 'name-asc':  return String(a.id).localeCompare(String(b.id));
        default:          return safeInt(b.available, 0) - safeInt(a.available, 0);
      }
    });
    return arr;
  }

  /* ---------------------------- 渲染 ---------------------------- */

  function roomCardHtml(room) {
    var rate = App.occupancyOf(room);
    var st = App.statusOf(rate);
    var available = safeInt(room.available, 0);
    var isFull = available <= 0;
    var tags = [];
    tags.push('<span class="tag-mini"><i class="bi bi-clock"></i>' + App.escapeHtml(room.openTime) + '-' + App.escapeHtml(room.closeTime) + '</span>');
    if (room.hasSocket) tags.push('<span class="tag-mini"><i class="bi bi-plug"></i>插座</span>');
    if (room.hasAC) tags.push('<span class="tag-mini"><i class="bi bi-snow"></i>空调 ' + App.escapeHtml(room.temperature) + '℃</span>');
    tags.push('<span class="tag-mini"><i class="bi bi-volume-mute"></i>安静度 ' + App.escapeHtml(room.quietLevel) + '/5</span>');

    return '<div class="col-12 col-md-6 col-xl-4">' +
      '<article class="room-card">' +
        '<div class="d-flex justify-content-between align-items-start gap-2">' +
          '<div>' +
            '<h3 class="room-title">' + App.escapeHtml(room.name) + '</h3>' +
            '<div class="room-sub mt-1">' +
              '<i class="bi bi-geo-alt"></i>' + App.escapeHtml(room.building) + ' · ' + App.escapeHtml(room.floor) + ' 层' +
              '<span class="text-muted-2">| 编号 ' + App.escapeHtml(room.id) + '</span>' +
            '</div>' +
          '</div>' +
          '<span class="badge-status ' + st.badge + '"><span class="dot"></span>' + st.text + '</span>' +
        '</div>' +
        '<div class="d-flex align-items-center gap-2">' +
          '<span class="tag-mini">' + App.escapeHtml(room.type) + '</span>' +
          (isFull ? '<span class="tag-mini" style="background:#fdeaeb;color:#c02b30;"><i class="bi bi-exclamation-circle"></i>暂无空位</span>' : '') +
        '</div>' +
        '<div class="d-flex justify-content-between align-items-end">' +
          '<div>' +
            '<div class="big-num' + (isFull ? ' full' : '') + '">' + available + '<small> / ' + App.escapeHtml(room.seats) + ' 座空闲</small></div>' +
          '</div>' +
          '<div class="text-end fs-12 text-muted-2" style="min-width:76px;">占用率 ' + rate + '%</div>' +
        '</div>' +
        '<div class="rate-bar ' + st.bar + '"><i style="width:' + rate + '%"></i></div>' +
        '<div class="d-flex flex-wrap gap-2">' + tags.join('') + '</div>' +
        '<div class="room-foot pt-1 border-top" style="border-color:var(--line)!important;">' +
          '<a class="btn btn-outline-brand btn-sm" href="three-d/scene.html?room=' + encodeURIComponent(room.id) + '">' +
            '<i class="bi bi-badge-3d"></i> 三维查看</a>' +
          '<a class="btn btn-brand btn-sm" href="manage.html?room=' + encodeURIComponent(room.id) + '">' +
            '<i class="bi bi-calendar-plus"></i> 去预约</a>' +
        '</div>' +
      '</article>' +
    '</div>';
  }

  function render(list) {
    if (list.length === 0) {
      App.renderEmpty($list,
        '没有符合条件的自习室',
        '当前筛选条件过于严格，没有匹配结果。可以尝试放宽条件，例如取消「仅看有空位」，或点击下方按钮恢复全部数据。');
      $list.append('<div class="col-12 text-center"><button type="button" class="btn btn-brand btn-sm js-reset-empty">' +
                   '<i class="bi bi-arrow-counterclockwise"></i> 清除筛选条件</button></div>');
      $list.find('.js-reset-empty').on('click', resetAll);
      return;
    }
    $list.html(list.map(roomCardHtml).join(''));
  }

  function updateSummary(list) {
    var seats = 0, available = 0;
    list.forEach(function (r) {
      seats += safeInt(r.seats, 0);
      available += safeInt(r.available, 0);
    });
    var rate = seats > 0 ? Math.round(((seats - available) / seats) * 1000) / 10 : 0;
    $summary.html('共 <b class="text-primary">' + list.length + '</b> 间自习室 · 座位 ' +
      App.thousands(seats) + ' 个 · 空闲 <b class="text-success">' + App.thousands(available) +
      '</b> 个 · 平均占用率 ' + rate + '%');
  }

  /* ---------------------------- 筛选主逻辑 ---------------------------- */

  function getFilters() {
    return {
      kw: $.trim($('#kw').val()),
      building: $('#fBuilding').val(),
      type: $('#fType').val(),
      floor: $('#fFloor').val(),
      sort: $('#fSort').val(),
      chip: activeChip
    };
  }

  function applyFilters() {
    var f = getFilters();
    var kw = f.kw.toLowerCase();

    var list = allRooms.filter(function (room) {
      if (f.building && room.building !== f.building) return false;
      if (f.type && room.type !== f.type) return false;
      if (f.floor && String(room.floor) !== String(f.floor)) return false;
      if (!matchChip(room, f.chip)) return false;
      if (kw) {
        var haystack = [room.name, room.building, room.type, room.id].join(' ').toLowerCase();
        if (haystack.indexOf(kw) === -1) return false;
      }
      return true;
    });

    list = sortList(list, f.sort);
    render(list);
    updateSummary(list);

    if (f.kw && list.length === 0) {
      App.showAlert($alertHost, 'warn',
        '关键词「<strong>' + App.escapeHtml(f.kw) + '</strong>」没有匹配到任何自习室，请更换关键词或清空搜索框。');
    } else if (list.length === 0) {
      App.showAlert($alertHost, 'warn', '当前组合条件下没有可用的自习室，建议减少筛选条件后重试。');
    } else {
      $alertHost.empty();
    }
  }

  function resetAll() {
    $('#filterForm')[0].reset();
    activeChip = 'all';
    $('#chipGroup .chip').removeClass('active').filter('[data-chip="all"]').addClass('active');
    applyFilters();
    App.toast('已重置全部筛选条件', 'ok');
  }

  /* ---------------------------- 动态筛选项 ---------------------------- */

  function fillOptions() {
    var buildings = [], types = [], floors = [];
    allRooms.forEach(function (r) {
      if ($.inArray(r.building, buildings) === -1) buildings.push(r.building);
      if ($.inArray(r.type, types) === -1) types.push(r.type);
      var f = safeInt(r.floor, -1);
      if (f > 0 && $.inArray(f, floors) === -1) floors.push(f);
    });
    floors.sort(function (a, b) { return a - b; });

    var opts = function (arr, labelFn, valueFn) {
      return arr.map(function (v) {
        return '<option value="' + App.escapeHtml(valueFn ? valueFn(v) : v) + '">' + App.escapeHtml(labelFn ? labelFn(v) : v) + '</option>';
      }).join('');
    };
    $('#fBuilding').append(opts(buildings));
    $('#fType').append(opts(types));
    $('#fFloor').append(opts(floors, function (v) { return v + ' 层'; }, function (v) { return String(v); }));
  }

  /* ---------------------------- 数据加载 ---------------------------- */

  function loadRooms() {
    App.renderLoading($list, '正在读取自习室基础数据（data/rooms.json）…');
    App.loadJSON('data/rooms.json').done(function (res) {
      var rooms = (res && res.rooms) || [];
      allRooms = rooms;
      $('#updateTime').text((res && res.updateTime) || '--');

      if (rooms.length === 0) {
        App.showAlert($alertHost, 'warn', '<strong>数据为空</strong><br>rooms.json 中没有任何自习室记录，请检查数据文件。');
        App.renderEmpty($list, '暂无自习室数据', '数据文件中 rooms 数组为空，请联系数据管理员补充数据。');
        $summary.text('共 0 间自习室');
        return;
      }

      App.showAlert($alertHost, 'ok',
        '<strong>数据加载完成</strong> 已读取 ' + rooms.length + ' 间自习室，' +
        '可按楼宇、类型、楼层筛选，或直接输入关键词搜索。');
      fillOptions();
      applyFilters();
    }).fail(function (jqXHR, textStatus) {
      var info = App.describeError(jqXHR, textStatus);
      App.showAlert($alertHost, 'error', '<strong>自习室数据加载失败：' + App.escapeHtml(info.title) + '</strong><br>' + App.escapeHtml(info.desc));
      $summary.text('共 0 间自习室');
      App.renderError($list, info.title, info.desc, function () {
        $('#fBuilding, #fType, #fFloor').find('option:not(:first)').remove();
        loadRooms();
      });
    });
  }

  /* ---------------------------- 事件绑定 ---------------------------- */

  $(function () {
    App.renderLoading($list, '正在读取自习室基础数据（data/rooms.json）…');

    // 关键词输入：300ms 防抖，避免每输入一个字符就重排 DOM
    var timer = null;
    $('#kw').on('input', function () {
      window.clearTimeout(timer);
      timer = window.setTimeout(applyFilters, 300);
    });
    $('#filterForm').on('submit', function (e) { e.preventDefault(); applyFilters(); });
    $('#fBuilding, #fType, #fFloor, #fSort').on('change', applyFilters);
    $('#btnReset').on('click', resetAll);

    $('#chipGroup').on('click', '.chip', function () {
      $(this).addClass('active').siblings().removeClass('active');
      activeChip = $(this).data('chip');
      applyFilters();
    });

    loadRooms();
  });
})(jQuery);