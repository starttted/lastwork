/* ==========================================================================
   首页脚本：加载统计 JSON -> 渲染指标卡 / 5 张图表 / 通知公告
   依赖：jQuery、ECharts、common.js
   ========================================================================== */
(function ($) {
  'use strict';

  var PALETTE = ['#17529e', '#2e7bd6', '#14b8a6', '#f59e0b', '#e5484d', '#8b5cf6'];
  var charts = [];          // 保存图表实例，便于统一 resize
  var $alertHost = $('#alertHost');

  /* ------------------------------------------------------------------
     加载失败时的统一处理：顶部提示条 + 各图表容器替换为错误状态
     ------------------------------------------------------------------ */
  function handleStatsError(jqXHR, textStatus) {
    var info = App.describeError(jqXHR, textStatus);
    App.showAlert($alertHost, 'error',
      '<strong>统计数据加载失败：' + App.escapeHtml(info.title) + '</strong><br>' +
      App.escapeHtml(info.desc));
    $('#updateTime').text('--');
    ['#statTotalSeats', '#statAvailable', '#statRate', '#statVisits'].forEach(function (sel) {
      $(sel).text('--');
    });
    ['#chartHourly', '#chartType', '#chartFloor', '#chartRank', '#chartWeekly'].forEach(function (sel) {
      App.renderError($(sel), info.title, info.desc, loadStats);
    });
  }

  /* ------------------------------------------------------------------
     指标卡
     ------------------------------------------------------------------ */
  function renderSummary(s) {
    $('#statTotalSeats').html(App.thousands(s.totalSeats) + '<small>座</small>');
    $('#statAvailable').html(App.thousands(s.availableSeats) + '<small>座</small>');
    $('#statRate').html(s.occupancyRate + '<small>%</small>');
    $('#statVisits').html(App.thousands(s.todayVisits) + '<small>人次</small>');
  }

  /* ------------------------------------------------------------------
     图表 1：今日在座人数趋势（折线图）
     ------------------------------------------------------------------ */
  function chartHourly(data) {
    var chart = echarts.init(document.getElementById('chartHourly'));
    chart.setOption({
      color: [PALETTE[1]],
      grid: { left: 8, right: 18, top: 30, bottom: 6, containLabel: true },
      tooltip: {
        trigger: 'axis',
        valueFormatter: function (v) { return App.thousands(v) + ' 人'; }
      },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: data.labels,
        axisLine: { lineStyle: { color: '#d9e1ec' } },
        axisLabel: { color: '#5b6676', fontSize: 11 },
        axisTick: { show: false }
      },
      yAxis: {
        type: 'value',
        name: '在座人数',
        nameTextStyle: { color: '#5b6676', fontSize: 11 },
        splitLine: { lineStyle: { color: '#eef1f5' } },
        axisLabel: { color: '#5b6676', fontSize: 11 }
      },
      series: [{
        name: '在座人数',
        type: 'line',
        smooth: true,
        symbolSize: 7,
        data: data.values,
        lineStyle: { width: 3 },
        itemStyle: { borderWidth: 2, borderColor: '#fff' },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(46,123,214,.35)' },
            { offset: 1, color: 'rgba(46,123,214,.02)' }
          ])
        },
        markPoint: {
          symbolSize: 48,
          data: [{ type: 'max', name: '峰值' }],
          label: { fontSize: 11 }
        },
        markLine: {
          silent: true,
          symbol: 'none',
          lineStyle: { type: 'dashed', color: '#14b8a6' },
          data: [{ type: 'average', name: '平均值' }],
          label: { formatter: '均值 {c}', color: '#14b8a6', fontSize: 11 }
        }
      }]
    });
    charts.push(chart);
  }

  /* ------------------------------------------------------------------
     图表 2：各类自习区座位占比（环形图）
     ------------------------------------------------------------------ */
  function chartType(dist) {
    var chart = echarts.init(document.getElementById('chartType'));
    var total = dist.reduce(function (sum, d) { return sum + Number(d.seats); }, 0);
    chart.setOption({
      color: PALETTE,
      tooltip: {
        trigger: 'item',
        formatter: function (p) {
          return p.name + '<br/>座位数：' + App.thousands(p.value) + ' 座<br/>占比：' + p.percent + '%';
        }
      },
      legend: { bottom: 0, icon: 'circle', itemWidth: 9, itemHeight: 9, textStyle: { color: '#5b6676', fontSize: 12 } },
      series: [{
        name: '座位数',
        type: 'pie',
        radius: ['46%', '68%'],
        center: ['50%', '44%'],
        avoidLabelOverlap: true,
        itemStyle: { borderColor: '#fff', borderWidth: 2, borderRadius: 4 },
        label: { show: false },
        labelLine: { show: false },
        emphasis: { scale: true, scaleSize: 6 },
        data: dist.map(function (d) { return { name: d.name, value: d.seats }; })
      }],
      graphic: [{
        type: 'text', left: 'center', top: '38%',
        style: { text: App.thousands(total), fontSize: 22, fontWeight: 'bold', fill: '#17529e', textAlign: 'center' }
      }, {
        type: 'text', left: 'center', top: '49%',
        style: { text: '总座位', fontSize: 12, fill: '#5b6676', textAlign: 'center' }
      }]
    });
    charts.push(chart);
  }

  /* ------------------------------------------------------------------
     图表 3：各楼层座位占用率（柱状图）
     ------------------------------------------------------------------ */
  function chartFloor(list) {
    var chart = echarts.init(document.getElementById('chartFloor'));
    chart.setOption({
      color: [PALETTE[0]],
      grid: { left: 8, right: 14, top: 26, bottom: 4, containLabel: true },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: function (ps) {
          var d = list[ps[0].dataIndex];
          return d.floor + '<br/>占用率：' + d.rate + '%<br/>已用 / 总座位：' + d.used + ' / ' + d.seats + ' 座';
        }
      },
      xAxis: {
        type: 'category',
        data: list.map(function (d) { return d.floor; }),
        axisLabel: { color: '#5b6676', fontSize: 12 },
        axisLine: { lineStyle: { color: '#d9e1ec' } },
        axisTick: { show: false }
      },
      yAxis: {
        type: 'value', max: 100,
        axisLabel: { formatter: '{value}%', color: '#5b6676', fontSize: 11 },
        splitLine: { lineStyle: { color: '#eef1f5' } }
      },
      series: [{
        type: 'bar',
        barWidth: '46%',
        data: list.map(function (d, i) {
          return {
            value: d.rate,
            itemStyle: {
              borderRadius: [6, 6, 0, 0],
              color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                { offset: 0, color: PALETTE[i % PALETTE.length] },
                { offset: 1, color: 'rgba(46,123,214,.55)' }
              ])
            }
          };
        }),
        label: { show: true, position: 'top', formatter: '{c}%', fontSize: 11, color: '#1b2330' }
      }]
    });
    charts.push(chart);
  }

  /* ------------------------------------------------------------------
     图表 4：占用率排行 TOP8（横向条形图）
     ------------------------------------------------------------------ */
  function chartRank(list) {
    var sorted = list.slice().sort(function (a, b) { return a.rate - b.rate; });
    var chart = echarts.init(document.getElementById('chartRank'));
    chart.setOption({
      grid: { left: 8, right: 46, top: 12, bottom: 4, containLabel: true },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        valueFormatter: function (v) { return v + '%'; }
      },
      xAxis: {
        type: 'value', max: 100,
        axisLabel: { formatter: '{value}%', color: '#5b6676', fontSize: 11 },
        splitLine: { lineStyle: { color: '#eef1f5' } }
      },
      yAxis: {
        type: 'category',
        data: sorted.map(function (d) { return d.name; }),
        axisLabel: { color: '#5b6676', fontSize: 11.5, width: 150, overflow: 'truncate' },
        axisLine: { lineStyle: { color: '#d9e1ec' } },
        axisTick: { show: false }
      },
      series: [{
        type: 'bar',
        barWidth: '55%',
        data: sorted.map(function (d) {
          return {
            value: d.rate,
            itemStyle: {
              borderRadius: [0, 6, 6, 0],
              color: d.rate >= 90 ? '#e5484d' : (d.rate >= 70 ? '#f59e0b' : '#2e7bd6')
            }
          };
        }),
        label: { show: true, position: 'right', formatter: '{c}%', fontSize: 11, color: '#5b6676' }
      }]
    });
    charts.push(chart);
  }

  /* ------------------------------------------------------------------
     图表 5：近一周入馆人次（柱状图）
     ------------------------------------------------------------------ */
  function chartWeekly(data) {
    var chart = echarts.init(document.getElementById('chartWeekly'));
    chart.setOption({
      color: [PALETTE[2]],
      grid: { left: 8, right: 16, top: 26, bottom: 4, containLabel: true },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        valueFormatter: function (v) { return App.thousands(v) + ' 人次'; }
      },
      xAxis: {
        type: 'category',
        data: data.labels,
        axisLabel: { color: '#5b6676', fontSize: 12 },
        axisLine: { lineStyle: { color: '#d9e1ec' } },
        axisTick: { show: false }
      },
      yAxis: {
        type: 'value',
        name: '人次',
        nameTextStyle: { color: '#5b6676', fontSize: 11 },
        axisLabel: { color: '#5b6676', fontSize: 11 },
        splitLine: { lineStyle: { color: '#eef1f5' } }
      },
      series: [{
        type: 'bar',
        barWidth: '42%',
        data: data.values,
        itemStyle: {
          borderRadius: [6, 6, 0, 0],
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: '#2dd4bf' },
            { offset: 1, color: 'rgba(20,184,166,.5)' }
          ])
        },
        label: { show: true, position: 'top', fontSize: 11, color: '#5b6676' }
      }]
    });
    charts.push(chart);
  }

  /* ------------------------------------------------------------------
     通知公告
     ------------------------------------------------------------------ */
  function loadNotices() {
    var $host = $('#noticeList');
    App.loadJSON('data/notices.json').done(function (res) {
      var list = (res && res.notices) || [];
      if (list.length === 0) {
        App.renderEmpty($host, '暂无通知', '图书馆当前没有发布新的通知公告。');
        return;
      }
      var html = list.map(function (n) {
        var levelClass = n.level === '重要' ? 'badge-full' : (n.level === '提示' ? 'badge-gray' : 'badge-fair');
        var d = String(n.date).split('-');
        return '<div class="notice-item">' +
                 '<div class="notice-date"><b>' + App.escapeHtml(d[2] || '--') + '</b>' + App.escapeHtml((d[1] || '') + '月') + '</div>' +
                 '<div class="flex-grow-1">' +
                   '<p class="notice-title">' + App.escapeHtml(n.title) +
                     ' <span class="badge-status ' + levelClass + ' ms-1">' + App.escapeHtml(n.level) + '</span></p>' +
                   '<p class="notice-desc">' + App.escapeHtml(n.content) + '</p>' +
                 '</div>' +
               '</div>';
      }).join('');
      $host.html(html);
    }).fail(function (jqXHR, textStatus) {
      var info = App.describeError(jqXHR, textStatus);
      App.renderError($host, '公告加载失败', info.desc, loadNotices);
    });
  }

  /* ------------------------------------------------------------------
     主流程
     ------------------------------------------------------------------ */
  var CHART_SELECTORS = ['#chartHourly', '#chartType', '#chartFloor', '#chartRank', '#chartWeekly'];

  // ECharts 在容器宽度为 0 时会退化成一个 0×0 的画布（例如页面尚未完成布局、
  // 或从后台标签页打开时）。这里先检测容器是否已具备宽度，未具备则下一帧重试。
  function renderCharts(res, attempt) {
    attempt = attempt || 0;
    var hasWidth = CHART_SELECTORS.some(function (sel) { return $(sel).width() > 0; });

    if (!hasWidth) {
      if (attempt < 10) {
        window.setTimeout(function () { renderCharts(res, attempt + 1); }, 100);
        return;
      }
      // 超过重试次数仍未拿到宽度（例如在后台标签页中打开），仍然先绘制一次，
      // 等窗口变为可见触发 resize 事件时，图表会自动按真实尺寸重绘
    }

    // 图表容器先清空，避免重复初始化
    CHART_SELECTORS.forEach(function (sel) { $(sel).empty(); });
    charts = [];

    chartHourly(res.hourlyTrend);
    chartType(res.typeDistribution);
    chartFloor(res.floorOccupancy);
    chartRank(res.roomRank);
    chartWeekly(res.weeklyVisits);

    // 布局稳定后再校准一次尺寸，避免出现图表被截断或留白
    window.setTimeout(function () {
      charts.forEach(function (c) { c.resize(); });
    }, 80);
  }

  function loadStats() {
    $alertHost.empty();
    App.loadJSON('data/stats.json').done(function (res) {
      if (!res || !res.summary) {
        App.showAlert($alertHost, 'warn', '<strong>数据为空</strong><br>统计数据文件中没有找到 summary 字段，页面已停止渲染，请检查 data/stats.json。');
        return;
      }
      $('#updateTime').text(res.updateTime || '--');
      renderSummary(res.summary);

      renderCharts(res);

      App.showAlert($alertHost, 'ok',
        '<strong>数据加载完成</strong> 共读取 ' + res.summary.roomCount + ' 间自习室、' +
        App.thousands(res.summary.totalSeats) + ' 个座位的统计信息，更新时间 ' + App.escapeHtml(res.updateTime || '--') + '。');
    }).fail(handleStatsError);
  }

  $(function () {
    App.renderLoading($('#noticeList'), '正在读取通知公告…');
    loadStats();
    loadNotices();

    // 响应式：窗口尺寸变化时重绘所有图表
    var timer = null;
    $(window).on('resize', function () {
      window.clearTimeout(timer);
      timer = window.setTimeout(function () {
        charts.forEach(function (c) { c.resize(); });
      }, 150);
    });
    $(window).on('load', function () {
      charts.forEach(function (c) { c.resize(); });
    });
  });
})(jQuery);