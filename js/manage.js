/* ==========================================================================
   预约管理页脚本：JSON 初始数据 + localStorage 增量持久化，实现增 / 删 / 改 / 查
   依赖：jQuery、Bootstrap(Modal)、common.js
   ========================================================================== */
(function ($) {
  'use strict';

  var baseList = [];      // reservations.json 中的初始数据（只读）
  var list = [];          // 当前工作数据（可能已被用户修改，存于 localStorage）
  var rooms = [];         // 自习室列表，用于新增/编辑下拉框
  var roomsReady = false;
  var editingId = null;   // 当前编辑的记录编号，null 表示新增
  var pendingAction = null; // 确认弹窗中的待执行动作

  var $alertHost = $('#alertHost');
  var $tableWrap = $('#tableWrap');
  var $summary = $('#mSummary');
  var editModal = null;
  var delModal = null;

  var STATUS_BADGE = {
    '已预约': 'badge-fair',
    '使用中': 'badge-busy',
    '已完成': 'badge-idle',
    '已取消': 'badge-gray'
  };

  /* ============================ 工具 ============================ */

  function findRoom(roomId) {
    var r = null;
    $.each(rooms, function (i, item) { if (item.id === roomId) { r = item; return false; } return true; });
    return r;
  }

  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + App.pad2(d.getMonth() + 1) + '-' + App.pad2(d.getDate());
  }

  // 把 HH:mm 转成分钟，便于比较时段先后
  function toMinutes(hhmm) {
    var p = String(hhmm || '').split(':');
    if (p.length !== 2) return NaN;
    var h = parseInt(p[0], 10), m = parseInt(p[1], 10);
    if (isNaN(h) || isNaN(m)) return NaN;
    return h * 60 + m;
  }

  // 判断两条记录是否时段冲突（同自习室、同日期、时间段重叠）
  function hasConflict(item) {
    var s1 = toMinutes(item.start), e1 = toMinutes(item.end);
    var found = null;
    $.each(list, function (i, other) {
      if (other.id === item.id) return true;                 // 跳过自己
      if (other.roomId !== item.roomId) return true;         // 不同自习室
      if (other.date !== item.date) return true;             // 不同日期
      if (other.status === '已取消') return true;            // 已取消不占用座位
      var s2 = toMinutes(other.start), e2 = toMinutes(other.end);
      if (s1 < e2 && s2 < e1) { found = other; return false; }
      return true;
    });
    return found;
  }

  /* ============================ 渲染 ============================ */

  function getFiltered() {
    var kw = $.trim($('#mKw').val()).toLowerCase();
    var status = $('#mStatus').val();
    var date = $('#mDate').val();
    return list.filter(function (r) {
      if (status && r.status !== status) return false;
      if (date && r.date !== date) return false;
      if (kw) {
        var hay = [r.id, r.roomName, r.student, r.studentNo, r.seat].join(' ').toLowerCase();
        if (hay.indexOf(kw) === -1) return false;
      }
      return true;
    });
  }

  function rowHtml(r) {
    var badge = STATUS_BADGE[r.status] || 'badge-gray';
    return '<tr>' +
      '<td class="text-nowrap"><span class="fw-semibold">' + App.escapeHtml(r.id) + '</span></td>' +
      '<td><div>' + App.escapeHtml(r.roomName) + '</div><div class="fs-12 text-muted-2">' + App.escapeHtml(r.roomId) + '</div></td>' +
      '<td class="text-nowrap"><div>' + App.escapeHtml(r.student) + '</div><div class="fs-12 text-muted-2">' + App.escapeHtml(r.studentNo) + '</div></td>' +
      '<td class="text-nowrap">' + App.escapeHtml(r.date) + '</td>' +
      '<td class="text-nowrap">' + App.escapeHtml(r.start) + ' - ' + App.escapeHtml(r.end) + '</td>' +
      '<td class="text-nowrap">' + App.escapeHtml(r.seat || '--') + '</td>' +
      '<td><span class="badge-status ' + badge + '"><span class="dot"></span>' + App.escapeHtml(r.status) + '</span></td>' +
      '<td class="text-nowrap">' +
        '<button type="button" class="btn btn-sm btn-outline-brand js-edit" data-id="' + App.escapeHtml(r.id) + '">' +
          '<i class="bi bi-pencil"></i> 修改</button> ' +
        '<button type="button" class="btn btn-sm btn-outline-danger js-del" data-id="' + App.escapeHtml(r.id) + '">' +
          '<i class="bi bi-trash3"></i> 删除</button>' +
      '</td>' +
    '</tr>';
  }

  function render() {
    var data = getFiltered();

    if (list.length === 0) {
      App.renderEmpty($tableWrap, '暂无预约记录', '数据文件与本地存储中都没有预约记录，可点击右上角「新增预约」创建第一条记录。');
    } else if (data.length === 0) {
      App.renderEmpty($tableWrap, '没有符合条件的记录',
        '当前关键词或状态筛选条件下没有匹配的预约记录，请调整筛选条件后重试。');
    } else {
      $tableWrap.html(
        '<table class="table table-soft align-middle">' +
          '<thead><tr>' +
            '<th scope="col">预约编号</th><th scope="col">自习室</th><th scope="col">预约人 / 学号</th>' +
            '<th scope="col">日期</th><th scope="col">时段</th><th scope="col">座位</th>' +
            '<th scope="col">状态</th><th scope="col" style="width:150px;">操作</th>' +
          '</tr></thead>' +
          '<tbody>' + data.map(rowHtml).join('') + '</tbody>' +
        '</table>'
      );
    }

    $summary.html('共 <b class="text-primary">' + list.length + '</b> 条记录，当前显示 ' + data.length + ' 条');
    updateStats();
  }

  function updateStats() {
    var booked = 0, using = 0;
    $.each(list, function (i, r) {
      if (r.status === '已预约') booked++;
      if (r.status === '使用中') using++;
    });
    $('#mTotal').text(list.length);
    $('#mBooked').text(booked);
    $('#mUsing').text(using);
    var fromStore = App.hasStore();
    $('#mDirty').text(fromStore ? '含本地修改' : '初始数据')
      .toggleClass('text-warning', fromStore)
      .css('font-size', fromStore ? '18px' : '16px');
  }

  function fillDateOptions() {
    var dates = [];
    $.each(list, function (i, r) { if ($.inArray(r.date, dates) === -1) dates.push(r.date); });
    dates.sort();
    var cur = $('#mDate').val();
    $('#mDate').empty().append('<option value="">全部日期</option>')
      .append(dates.map(function (d) { return '<option value="' + App.escapeHtml(d) + '">' + App.escapeHtml(d) + '</option>'; }).join(''));
    if (cur) { $('#mDate').val(cur); }
  }

  function fillRoomOptions(selectedId) {
    var html = '<option value="">请选择自习室</option>' + rooms.map(function (r) {
      return '<option value="' + App.escapeHtml(r.id) + '">' + App.escapeHtml(r.name + '（' + r.id + '）') + '</option>';
    }).join('');
    $('#fRoom').html(html).val(selectedId || '');
  }

  /* ============================ 表单校验 ============================ */

  function setInvalid(id, on) {
    $(id).toggleClass('is-invalid', !!on);
  }

  // 逐项校验，返回校验通过后的记录对象；不通过时返回 null 并给出提示
  function validateForm() {
    var roomId = $('#fRoom').val();
    var student = $.trim($('#fStudent').val());
    var studentNo = $.trim($('#fStudentNo').val());
    var date = $('#fDate').val();
    var start = $('#fStart').val();
    var end = $('#fEnd').val();
    var seat = $.trim($('#fSeat').val());
    var status = $('#fStatus').val();

    setInvalid('#fRoom', false); setInvalid('#fStudent', false); setInvalid('#fStudentNo', false);
    setInvalid('#fDate', false); setInvalid('#fStart', false); setInvalid('#fEnd', false);

    var firstError = '';
    var focusEl = null;

    if (!roomId) { setInvalid('#fRoom', true); firstError = firstError || '请选择自习室'; focusEl = focusEl || '#fRoom'; }
    if (!student || student.length > 10) { setInvalid('#fStudent', true); firstError = firstError || '预约人姓名不能为空，且不超过 10 个字符'; focusEl = focusEl || '#fStudent'; }
    if (!/^\d{8}$/.test(studentNo)) { setInvalid('#fStudentNo', true); firstError = firstError || '学号必须为 8 位数字'; focusEl = focusEl || '#fStudentNo'; }
    if (!date) { setInvalid('#fDate', true); firstError = firstError || '请选择预约日期'; focusEl = focusEl || '#fDate'; }
    if (!start) { setInvalid('#fStart', true); firstError = firstError || '请选择开始时间'; focusEl = focusEl || '#fStart'; }
    if (!end) { setInvalid('#fEnd', true); firstError = firstError || '请选择结束时间'; focusEl = focusEl || '#fEnd'; }

    if (firstError) {
      App.toast(firstError, 'error');
      if (focusEl) { $(focusEl).trigger('focus'); }
      return null;
    }

    var s = toMinutes(start), e = toMinutes(end);
    if (s >= e) {
      setInvalid('#fStart', true); setInvalid('#fEnd', true);
      App.toast('结束时间必须晚于开始时间', 'error');
      $('#fEnd').trigger('focus');
      return null;
    }
    if (e - s > 240) {
      setInvalid('#fEnd', true);
      App.toast('单次预约时长不能超过 4 小时', 'error');
      return null;
    }
    if (date < todayStr()) {
      setInvalid('#fDate', true);
      App.toast('不能预约今天以前的日期', 'error');
      return null;
    }

    var room = findRoom(roomId);
    if (!room) {
      setInvalid('#fRoom', true);
      App.toast('所选自习室不存在，请重新选择', 'error');
      return null;
    }
    if (!seat) {
      // 未填写座位号时，按"楼宇编号-序号"自动生成一个临时座位号
      seat = String(room.id).charAt(0) + '-' + App.pad2(Math.floor(Math.random() * room.seats) + 1);
    }

    var record = {
      id: editingId || App.nextId(list, date),
      roomId: roomId,
      roomName: room.name,
      student: student,
      studentNo: studentNo,
      date: date,
      start: start,
      end: end,
      seat: seat,
      status: status
    };

    var conflict = hasConflict(record);
    if (conflict) {
      App.toast('时段冲突：' + conflict.roomName + ' 在 ' + conflict.start + '-' + conflict.end +
                ' 已被 ' + conflict.student + ' 预约', 'error');
      return null;
    }
    return record;
  }

  /* ============================ 增 / 改 / 删 ============================ */

  function openAdd() {
    editingId = null;
    $('#editModalTitle').text('新增预约');
    $('#editForm')[0].reset();
    ['#fRoom', '#fStudent', '#fStudentNo', '#fDate', '#fStart', '#fEnd'].forEach(function (s) { setInvalid(s, false); });
    fillRoomOptions($('#fRoom').data('preset') || '');
    $('#fDate').val(todayStr()).attr('min', todayStr());
    $('#fStatus').val('已预约');
    editModal.show();
  }

  function openEdit(id) {
    var r = null;
    $.each(list, function (i, item) { if (item.id === id) { r = item; return false; } return true; });
    if (!r) { App.toast('未找到该预约记录，可能已被删除', 'error'); return; }

    editingId = id;
    $('#editModalTitle').text('修改预约 · ' + id);
    ['#fRoom', '#fStudent', '#fStudentNo', '#fDate', '#fStart', '#fEnd'].forEach(function (s) { setInvalid(s, false); });
    fillRoomOptions(r.roomId);
    $('#fSeat').val(r.seat || '');
    $('#fStudent').val(r.student);
    $('#fStudentNo').val(r.studentNo);
    $('#fDate').val(r.date).attr('min', todayStr());
    $('#fStart').val(r.start);
    $('#fEnd').val(r.end);
    $('#fStatus').val(r.status);
    editModal.show();
  }

  function saveForm() {
    var record = validateForm();
    if (!record) return;

    if (editingId) {
      var idx = -1;
      $.each(list, function (i, item) { if (item.id === editingId) { idx = i; return false; } return true; });
      list[idx] = record;
      App.toast('预约记录 ' + record.id + ' 已更新', 'ok');
    } else {
      list.push(record);
      App.toast('已新增预约记录 ' + record.id, 'ok');
    }

    if (!App.writeStore(list)) {
      App.showAlert($alertHost, 'warn',
        '<strong>本地保存失败</strong><br>浏览器禁用了本地存储（localStorage），' +
        '本次修改仅在当前页面有效，刷新后会丢失。请检查浏览器隐私设置。');
    } else {
      App.showAlert($alertHost, 'ok',
        '<strong>操作已保存</strong> 预约数据已写入浏览器本地存储，刷新页面不会丢失。' +
        '如需恢复 JSON 初始数据，请点击「恢复初始数据」。');
    }

    editModal.hide();
    fillDateOptions();
    render();
  }

  function askDelete(id) {
    var r = null;
    $.each(list, function (i, item) { if (item.id === id) { r = item; return false; } return true; });
    if (!r) { App.toast('未找到该预约记录', 'error'); return; }

    $('.modal-title', delModal._element).text('确认删除');
    $('#delBody').html('确定要删除预约记录 <b>' + App.escapeHtml(r.id) + '</b>（' + App.escapeHtml(r.student) +
      ' · ' + App.escapeHtml(r.roomName) + ' · ' + App.escapeHtml(r.date) + ' ' + App.escapeHtml(r.start) +
      '-' + App.escapeHtml(r.end) + '）吗？<br><span class="text-muted-2 fs-13">删除后可通过「恢复初始数据」还原 JSON 初始记录。</span>');

    pendingAction = function () {
      var before = list.length;
      list = list.filter(function (item) { return item.id !== id; });
      if (list.length === before) { App.toast('删除失败：记录已不存在', 'error'); return; }
      App.writeStore(list);
      App.toast('预约记录 ' + id + ' 已删除', 'ok');
      fillDateOptions();
      render();
    };
    delModal.show();
  }

  function askRestore() {
    $('.modal-title', delModal._element).text('恢复初始数据');
    $('#delBody').html('将丢弃浏览器本地保存的全部修改，恢复为 <code>data/reservations.json</code> 中的 ' +
      baseList.length + ' 条初始记录。<br><span class="text-muted-2 fs-13">该操作不可撤销，确定继续吗？</span>');
    pendingAction = function () {
      App.clearStore();
      list = baseList.slice();
      App.showAlert($alertHost, 'info', '<strong>已恢复初始数据</strong> 当前显示的是 JSON 文件中的 ' + baseList.length + ' 条初始预约记录。');
      App.toast('已恢复初始数据', 'ok');
      fillDateOptions();
      render();
    };
    delModal.show();
  }

  /* ============================ 数据加载 ============================ */

  function loadRooms() {
    return App.loadJSON('data/rooms.json').done(function (res) {
      rooms = (res && res.rooms) || [];
      roomsReady = rooms.length > 0;
      if (!roomsReady) {
        App.toast('自习室列表为空，新增预约时无法选择自习室', 'warn');
      }
    }).fail(function (jqXHR, textStatus) {
      var info = App.describeError(jqXHR, textStatus);
      roomsReady = false;
      App.showAlert($alertHost, 'warn',
        '<strong>自习室列表加载失败：' + App.escapeHtml(info.title) + '</strong><br>' +
        App.escapeHtml(info.desc) + ' 预约记录仍可查看，但新增/修改时无法选择自习室。');
    });
  }

  function loadReservations() {
    App.renderLoading($tableWrap, '正在读取预约记录（data/reservations.json）…');
    App.loadJSON('data/reservations.json').done(function (res) {
      baseList = (res && res.reservations) || [];
      $('#updateTime').text((res && res.updateTime) || '--');

      var stored = App.readStore();
      if (stored) {
        list = stored;
        App.showAlert($alertHost, 'info',
          '<strong>检测到本地修改</strong> 当前显示的是浏览器本地保存的 ' + list.length +
          ' 条记录（非 JSON 初始数据）。点击「恢复初始数据」可还原。');
      } else {
        list = baseList.slice();
        App.showAlert($alertHost, 'ok',
          '<strong>数据加载完成</strong> 已读取 ' + list.length + ' 条预约记录，可进行筛选、新增、修改和删除操作。');
      }
      fillDateOptions();
      render();
    }).fail(function (jqXHR, textStatus) {
      var info = App.describeError(jqXHR, textStatus);
      App.showAlert($alertHost, 'error', '<strong>预约记录加载失败：' + App.escapeHtml(info.title) + '</strong><br>' + App.escapeHtml(info.desc));
      $summary.text('共 0 条记录');
      App.renderError($tableWrap, info.title, info.desc, loadReservations);
    });
  }

  /* ============================ 事件绑定 ============================ */

  $(function () {
    editModal = new bootstrap.Modal(document.getElementById('editModal'));
    delModal = new bootstrap.Modal(document.getElementById('delModal'));

    // 从自习室查询页带过来的 ?room= 参数，新增预约时自动预选
    var preset = App.getQuery('room', '');
    if (preset) { $('#fRoom').data('preset', preset); }

    var timer = null;
    $('#mKw').on('input', function () {
      window.clearTimeout(timer);
      timer = window.setTimeout(render, 250);
    });
    $('#mStatus, #mDate').on('change', render);

    $('#btnClearFilter').on('click', function () {
      $('#mKw').val('');
      $('#mStatus').val('');
      $('#mDate').val('');
      render();
      App.toast('已清空筛选条件', 'info');
    });

    $('#btnAdd').on('click', function () {
      if (!roomsReady) { App.toast('自习室列表尚未加载完成，请稍后再试', 'warn'); return; }
      openAdd();
    });

    $('#btnRestore').on('click', askRestore);

    $('#tableWrap').on('click', '.js-edit', function () {
      openEdit($(this).data('id'));
    }).on('click', '.js-del', function () {
      askDelete($(this).data('id'));
    });

    $('#btnSave').on('click', saveForm);
    $('#editForm').on('submit', function (e) { e.preventDefault(); saveForm(); });

    // 学号输入框只允许输入数字
    $('#fStudentNo').on('input', function () {
      var v = $(this).val().replace(/\D/g, '').slice(0, 8);
      $(this).val(v);
    });

    $('#btnDelConfirm').on('click', function () {
      var fn = pendingAction;
      pendingAction = null;
      delModal.hide();
      if (typeof fn === 'function') { fn(); }
    });

    loadRooms();
    loadReservations();
  });
})(jQuery);