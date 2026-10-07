/* ==========================================================================
   图书馆自习室 · 信息与数据展示中心  公共脚本
   依赖：jQuery 3.x（本文件必须在使用 jQuery 的页面中、于页面脚本之前引入）
   职责：1) 统一的 JSON 加载与错误处理  2) 通用 UI 组件(加载/空/错误状态、Toast)
         3) 座位状态计算与格式化工具   4) 本地存储(预约管理页的数据持久化)
   ========================================================================== */

window.App = (function ($) {
  'use strict';

  /* ------------------------------------------------------------------
     一、通用工具
     ------------------------------------------------------------------ */

  // HTML 转义，防止 JSON 中的数据里含有特殊字符时破坏页面结构
  function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // 读取地址栏参数，如 rooms.html?building=主图书馆 中的 building
  function getQuery(name, defaultValue) {
    var reg = new RegExp('(^|&)' + name + '=([^&]*)(&|$)');
    var m = window.location.search.substr(1).match(reg);
    if (m === null) return defaultValue === undefined ? '' : defaultValue;
    try { return decodeURIComponent(m[2]); } catch (e) { return m[2]; }
  }

  // 千分位
  function thousands(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  // 把 "2026-10-07 20:30" 格式化为 "10-07 20:30"
  function shortTime(str) {
    if (!str) return '--';
    var parts = String(str).split(' ');
    return parts.length > 1 ? parts[1] + ' · ' + parts[0].substring(5) : str;
  }

  /* ------------------------------------------------------------------
     二、座位状态计算
     占用率 occ(%)：>=90 紧张 / >=70 较满 / >=40 适中 / <40 空闲
     ------------------------------------------------------------------ */
  function occupancyOf(room) {
    var seats = Number(room.seats) || 0;
    var available = Number(room.available) || 0;
    if (seats <= 0) return 0;
    var rate = ((seats - available) / seats) * 100;
    return Math.max(0, Math.min(100, Math.round(rate * 10) / 10));
  }

  function statusOf(rate) {
    if (rate >= 90) return { key: 'full', text: '紧张', badge: 'badge-full', bar: 'is-full' };
    if (rate >= 70) return { key: 'busy', text: '较满', badge: 'badge-busy', bar: 'is-busy' };
    if (rate >= 40) return { key: 'fair', text: '适中', badge: 'badge-fair', bar: '' };
    return { key: 'idle', text: '空闲', badge: 'badge-idle', bar: '' };
  }

  /* ------------------------------------------------------------------
     三、统一的 JSON 加载 + 错误处理
     用法：App.loadJSON('data/rooms.json').done(fn).fail(fn)
     ------------------------------------------------------------------ */
  function loadJSON(url) {
    return $.ajax({
      url: url,
      type: 'GET',
      dataType: 'json',
      cache: false,
      timeout: 8000
    });
  }

  // 把 jQuery 的 jqXHR 错误对象翻译成用户看得懂的中文提示
  function describeError(jqXHR, textStatus) {
    if (textStatus === 'timeout') {
      return {
        title: '请求超时',
        desc: '数据加载超过 8 秒仍未返回。请检查本机网络是否正常，然后点击「重新加载」重试。'
      };
    }
    if (textStatus === 'parsererror') {
      return {
        title: '数据格式错误',
        desc: '数据文件的内容不是合法的 JSON 格式（可能缺少逗号或引号不配对）。请使用 JSON 校验工具检查数据文件。'
      };
    }
    if (jqXHR && jqXHR.status === 404) {
      return {
        title: '数据文件不存在（HTTP 404）',
        desc: '服务器上没有找到该数据文件。请确认 data 目录下的 JSON 文件已随项目一起提交，且文件名大小写完全一致。'
      };
    }
    if (jqXHR && jqXHR.status === 0) {
      return {
        title: '无法读取本地数据文件',
        desc: '浏览器出于安全策略禁止 file:// 协议直接读取 JSON。请勿直接双击打开 HTML 文件，' +
              '请在项目根目录执行 python -m http.server 8000，再访问 http://localhost:8000/ 。'
      };
    }
    var code = jqXHR && jqXHR.status ? jqXHR.status : '未知';
    return {
      title: '数据加载失败（状态码 ' + code + '）',
      desc: '读取 ' + (jqXHR && jqXHR.responseURL ? jqXHR.responseURL : '数据文件') + ' 时发生错误，请稍后重试。'
    };
  }

  /* ------------------------------------------------------------------
     四、通用状态区渲染（加载中 / 空数据 / 错误）
     ------------------------------------------------------------------ */
  function renderLoading($container, text) {
    $container.html(
      '<div class="state-box">' +
        '<div class="spinner-border text-primary mb-3" role="status" style="width:2rem;height:2rem;"></div>' +
        '<div class="state-title">正在加载数据…</div>' +
        '<div class="state-desc">' + escapeHtml(text || '正在从本地 JSON 文件读取数据，请稍候。') + '</div>' +
      '</div>'
    );
  }

  function renderEmpty($container, title, desc) {
    $container.html(
      '<div class="state-box">' +
        '<div class="state-icon"><i class="bi bi-inbox"></i></div>' +
        '<div class="state-title">' + escapeHtml(title || '暂无数据') + '</div>' +
        '<div class="state-desc">' + escapeHtml(desc || '当前条件下没有符合要求的数据。') + '</div>' +
      '</div>'
    );
  }

  function renderError($container, title, desc, retryHandler) {
    $container.html(
      '<div class="state-box is-error">' +
        '<div class="state-icon"><i class="bi bi-exclamation-triangle"></i></div>' +
        '<div class="state-title">' + escapeHtml(title) + '</div>' +
        '<div class="state-desc">' + escapeHtml(desc) + '</div>' +
        '<button type="button" class="btn btn-outline-brand btn-sm js-retry">' +
          '<i class="bi bi-arrow-clockwise"></i> 重新加载' +
        '</button>' +
      '</div>'
    );
    if (typeof retryHandler === 'function') {
      $container.find('.js-retry').on('click', retryHandler);
    }
  }

  // 页面顶部的提示条
  function showAlert($host, type, message) {
    var icon = type === 'ok' ? 'check-circle' : (type === 'error' ? 'x-octagon' : (type === 'warn' ? 'exclamation-triangle' : 'info-circle'));
    $host.html(
      '<div class="app-alert is-' + type + ' p-2 px-3">' +
        '<i class="bi bi-' + icon + '"></i><div>' + message + '</div>' +
      '</div>'
    );
  }

  // 右下角漂浮提示
  function toast(message, type) {
    type = type || 'info';
    var $host = $('#toastHost');
    if ($host.length === 0) { $host = $('<div id="toastHost"></div>').appendTo('body'); }
    var icon = type === 'ok' ? 'check-circle-fill' : (type === 'error' ? 'x-circle-fill' : (type === 'warn' ? 'exclamation-triangle-fill' : 'info-circle-fill'));
    var $el = $(
      '<div class="app-alert is-' + type + ' shadow-sm p-2 px-3" style="min-width:220px;">' +
        '<i class="bi bi-' + icon + '"></i><div>' + escapeHtml(message) + '</div>' +
      '</div>'
    );
    $host.append($el);
    $el.hide().fadeIn(140);
    window.setTimeout(function () {
      $el.fadeOut(220, function () { $(this).remove(); });
    }, 2600);
  }

  /* ------------------------------------------------------------------
     五、预约数据的本地持久化（前端无后端，用 localStorage 保存增删改结果）
     ------------------------------------------------------------------ */
  var STORE_KEY = 'lxlib.reservations.v1';

  // 生成下一个预约编号，格式 R + yyyyMMdd + 3 位流水号
  function nextId(list, date) {
    var day = String(date || '').replace(/-/g, '');
    var prefix = 'R' + day;
    var max = 0;
    $.each(list || [], function (i, item) {
      if (String(item.id).indexOf(prefix) === 0) {
        var n = parseInt(String(item.id).substr(prefix.length), 10);
        if (!isNaN(n) && n > max) max = n;
      }
    });
    return prefix + ('00' + (max + 1)).slice(-3);
  }

  function readStore() {
    try {
      var raw = window.localStorage.getItem(STORE_KEY);
      if (!raw) return null;
      var data = JSON.parse(raw);
      return $.isArray(data) ? data : null;
    } catch (e) {
      // localStorage 被禁用或内容损坏时，退回到使用 JSON 原始数据，不影响页面运行
      return null;
    }
  }

  function writeStore(list) {
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify(list));
      return true;
    } catch (e) {
      return false;
    }
  }

  function clearStore() {
    try { window.localStorage.removeItem(STORE_KEY); } catch (e) { /* 忽略 */ }
  }

  function hasStore() {
    try { return window.localStorage.getItem(STORE_KEY) !== null; } catch (e) { return false; }
  }

  /* ------------------------------------------------------------------
     六、导航高亮（按文件名匹配，保证 4 个页面导航状态一致）
     ------------------------------------------------------------------ */
  function markActiveNav() {
    var path = window.location.pathname.split('/').pop() || 'index.html';
    $('.app-navbar .nav-link').each(function () {
      // href 可能是 "three-d/scene.html" 这类带子目录的路径，只比较文件名部分
      var href = ($(this).attr('href') || '').split('/').pop().split('?')[0];
      if (href === path) { $(this).addClass('active'); }
    });
  }

  $(markActiveNav);

  /* ------------------------------------------------------------------ */
  return {
    escapeHtml: escapeHtml,
    getQuery: getQuery,
    thousands: thousands,
    pad2: pad2,
    shortTime: shortTime,
    occupancyOf: occupancyOf,
    statusOf: statusOf,
    loadJSON: loadJSON,
    describeError: describeError,
    renderLoading: renderLoading,
    renderEmpty: renderEmpty,
    renderError: renderError,
    showAlert: showAlert,
    toast: toast,
    nextId: nextId,
    readStore: readStore,
    writeStore: writeStore,
    clearStore: clearStore,
    hasStore: hasStore,
    STORE_KEY: STORE_KEY
  };
})(jQuery);