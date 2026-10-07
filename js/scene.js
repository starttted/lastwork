/* ==========================================================================
   三维展示页脚本：用 Three.js 把图书馆建成"彩色立方体堆叠"的立体模型
   —— 一栋楼一层一个立方体，立方体颜色代表该楼层的座位占用率
   交互：拖动旋转 / 滚轮缩放 / 右键平移 / 悬停高亮 / 点击查看楼层详情
   依赖：jQuery、Three.js r128、OrbitControls、common.js
   ========================================================================== */
(function ($) {
  'use strict';

  /* 占用率 -> 立方体颜色的分级（与页面图例保持一致） */
  var LEVELS = [
    { max: 50,  color: 0x22c55e, text: '空闲' },
    { max: 70,  color: 0x3b82f6, text: '适中' },
    { max: 85,  color: 0xf59e0b, text: '较满' },
    { max: 101, color: 0xef4444, text: '紧张' }
  ];

  var CUBE_W = 4.0;      // 立方体长宽
  var CUBE_H = 1.4;      // 立方体高（一层楼）
  var GAP = 0.12;        // 层与层之间的缝隙
  var SPACING = 7.0;     // 楼与楼之间的间距
  var BASE_H = 0.35;     // 地基高度

  var scene, camera, renderer, controls, raycaster, pointer;
  var modelGroup = null;        // 所有建筑的立方体
  var cubes = [];               // 可拾取的立方体
  var buildings = [];           // 解析后的楼宇数据
  var hovered = null;
  var animId = null;
  var ready = false;

  var $wrap = $('#sceneWrap');
  var $tip = $('#sceneTip');
  var $status = $('#sceneStatus');
  var $alertHost = $('#alertHost');

  /* ------------------------------ 工具 ------------------------------ */

  function safeInt(v, def) {
    var n = parseInt(v, 10);
    return isNaN(n) ? def : n;
  }

  function levelOf(rate) {
    for (var i = 0; i < LEVELS.length; i++) {
      if (rate < LEVELS[i].max) return LEVELS[i];
    }
    return LEVELS[LEVELS.length - 1];
  }

  function rateColor(rate) { return levelOf(rate).color; }

  // 把扁平的自习室数组整理成 "楼宇 -> 楼层" 的层次结构
  function groupByBuilding(rooms) {
    var map = {};
    var order = [];

    $.each(rooms, function (i, room) {
      var bName = room.building || '未命名楼宇';
      if (!map[bName]) {
        map[bName] = { name: bName, floors: {}, order: [] };
        order.push(bName);
      }
      var floor = safeInt(room.floor, 1);
      var b = map[bName];
      if (!b.floors[floor]) {
        b.floors[floor] = { floor: floor, seats: 0, used: 0, rooms: [] };
        b.order.push(floor);
      }
      var seats = safeInt(room.seats, 0);
      var available = safeInt(room.available, 0);
      b.floors[floor].seats += seats;
      b.floors[floor].used += Math.max(0, seats - available);
      b.floors[floor].rooms.push(room);
    });

    return order.map(function (name) {
      var b = map[name];
      b.order.sort(function (x, y) { return x - y; });
      b.floorList = b.order.map(function (f) {
        var fd = b.floors[f];
        fd.rate = fd.seats > 0 ? Math.round((fd.used / fd.seats) * 1000) / 10 : 0;
        return fd;
      });
      b.seats = b.floorList.reduce(function (s, f) { return s + f.seats; }, 0);
      b.used = b.floorList.reduce(function (s, f) { return s + f.used; }, 0);
      b.rate = b.seats > 0 ? Math.round((b.used / b.seats) * 1000) / 10 : 0;
      return b;
    });
  }

  /* ------------------------------ 场景初始化 ------------------------------ */

  function initScene() {
    if (typeof THREE === 'undefined') {
      showFatal('三维引擎加载失败', '未检测到 Three.js（libs/three.min.js）。请确认该文件已随项目提交，且路径大小写一致。');
      return false;
    }

    var w = $wrap.width();
    var h = $wrap.height();
    // 容器尚未完成布局时（宽度为 0），先用兜底尺寸初始化，等 resize 事件再校正
    if (w <= 0 || h <= 0) { w = 800; h = 460; }

    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch (e) {
      showFatal('浏览器不支持 WebGL', '当前浏览器或显卡驱动不支持 WebGL，无法渲染三维模型。请更换 Chrome / Edge 最新版浏览器后重试。');
      return false;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h);
    $wrap.append(renderer.domElement);

    scene = new THREE.Scene();

    camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 500);
    camera.position.set(14, 16, 20);

    // 灯光：环境光保证整体亮度，平行光提供明暗层次，让立方体有立体感
    scene.add(new THREE.AmbientLight(0xffffff, 0.78));
    var dir = new THREE.DirectionalLight(0xffffff, 0.7);
    dir.position.set(12, 24, 14);
    scene.add(dir);
    scene.add(new THREE.HemisphereLight(0xffffff, 0xd6e2f2, 0.3));

    // 交互控制：旋转 / 缩放 / 平移
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 8;
    controls.maxDistance = 90;
    controls.maxPolarAngle = Math.PI / 2.05;
    controls.target.set(0, 3, 0);
    controls.update();

    // 地面网格，提供空间参考
    var grid = new THREE.GridHelper(60, 30, 0xc7d2e0, 0xdde5ef);
    scene.add(grid);

    raycaster = new THREE.Raycaster();
    pointer = new THREE.Vector2();

    ready = true;
    return true;
  }

  function showFatal(title, desc) {
    App.renderError($wrap, title, desc, function () { window.location.reload(); });
    $status.text(title);
    App.showAlert($alertHost, 'error', '<strong>' + App.escapeHtml(title) + '</strong><br>' + App.escapeHtml(desc));
  }

  /* ------------------------------ 构建立体模型 ------------------------------ */

  function clearModel() {
    if (!modelGroup) return;
    scene.remove(modelGroup);
    modelGroup.traverse(function (o) {
      if (o.geometry) o.geometry.dispose();
      if (o.material) { o.material.dispose(); }
    });
    modelGroup = null;
    cubes = [];
    hovered = null;
    $tip.removeClass('show');
  }

  function buildModel() {
    clearModel();
    modelGroup = new THREE.Group();

    var total = buildings.length;
    var maxFloors = 1;
    $.each(buildings, function (i, b) { maxFloors = Math.max(maxFloors, b.floorList.length); });

    var baseMat = new THREE.MeshLambertMaterial({ color: 0x94a3b8 });

    $.each(buildings, function (bi, b) {
      var group = new THREE.Group();
      group.position.x = (bi - (total - 1) / 2) * SPACING;

      // 地基
      var base = new THREE.Mesh(new THREE.BoxGeometry(CUBE_W + 0.5, BASE_H, CUBE_W + 0.5), baseMat);
      base.position.y = BASE_H / 2;
      group.add(base);

      // 逐层堆叠立方体：每层一个立方体，颜色代表该层占用率
      $.each(b.floorList, function (fi, fd) {
        var mat = new THREE.MeshLambertMaterial({ color: rateColor(fd.rate) });
        var cube = new THREE.Mesh(new THREE.BoxGeometry(CUBE_W, CUBE_H, CUBE_W), mat);
        cube.position.y = BASE_H + fi * (CUBE_H + GAP) + CUBE_H / 2;

        // 把楼层信息挂在网格对象上，射线拾取后直接读取
        cube.userData = {
          building: b.name,
          floor: fd.floor,
          rate: fd.rate,
          seats: fd.seats,
          used: fd.used,
          level: levelOf(fd.rate).text,
          baseColor: rateColor(fd.rate),
          mat: mat
        };

        group.add(cube);
        cubes.push(cube);
      });

      modelGroup.add(group);
    });

    scene.add(modelGroup);

    $status.html('已生成三维立体模型：<b>' + total + '</b> 栋楼、共 <b>' + cubes.length +
      '</b> 个立方体（每个立方体代表一个楼层，最高 ' + maxFloors + ' 层）。');

    resetView();
    renderSidebar();
  }

  /* ------------------------------ 视角 ------------------------------ */

  function resetView() {
    var total = buildings.length || 3;
    var width = total * SPACING;
    var size = Math.max(width, 14);
    camera.position.set(size * 0.72, size * 0.62 + 8, size * 0.95 + 10);
    controls.target.set(0, 3, 0);
    camera.lookAt(0, 3, 0);
    controls.update();
  }

  // 点击侧边列表时，把视角对准对应的立方体
  function focusCube(cube) {
    var target = cube.getWorldPosition(new THREE.Vector3());
    controls.target.copy(target);
    var dir = new THREE.Vector3(1, 0.85, 1.15).normalize().multiplyScalar(11);
    camera.position.copy(target).add(dir);
    camera.lookAt(target);
    controls.update();
  }

  /* ------------------------------ 交互 ------------------------------ */

  function pickCube(ev) {
    if (!modelGroup) return null;
    var rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    var hits = raycaster.intersectObjects(cubes, false);
    return hits.length > 0 ? hits[0].object : null;
  }

  function onPointerMove(ev) {
    if (!ready || !modelGroup) return;
    var obj = pickCube(ev);

    if (hovered && hovered !== obj) { hovered.scale.set(1, 1, 1); hovered = null; }

    if (obj) {
      if (hovered !== obj) { hovered = obj; obj.scale.set(1.06, 1.12, 1.06); }
      renderer.domElement.style.cursor = 'pointer';
      var ud = obj.userData;
      $tip.text(ud.building + ' ' + ud.floor + 'F · ' + ud.level + ' · 占用率 ' + ud.rate + '%')
          .addClass('show')
          .css({
            left: (ev.clientX - $wrap[0].getBoundingClientRect().left) + 'px',
            top: (ev.clientY - $wrap[0].getBoundingClientRect().top) + 'px'
          });
    } else {
      renderer.domElement.style.cursor = 'grab';
      $tip.removeClass('show');
    }
  }

  function onPointerDown(ev) {
    if (!ready || !modelGroup || ev.button !== 0) return;
    var obj = pickCube(ev);
    if (!obj) return;
    var ud = obj.userData;
    App.toast(ud.building + ' ' + ud.floor + 'F：占用率 ' + ud.rate + '%（' +
      ud.level + '），已用 ' + ud.used + ' / ' + ud.seats + ' 座', 'info');
  }

  /* ------------------------------ 侧边列表 ------------------------------ */

  function renderSidebar() {
    var html = buildings.map(function (b, bi) {
      var st = App.statusOf(b.rate);
      var rows = b.floorList.map(function (fd, fi) {
        var lv = levelOf(fd.rate);
        var hex = '#' + ('000000' + lv.color.toString(16)).slice(-6);
        return '<div class="d-flex align-items-center gap-2 py-2 js-floor" data-b="' + bi + '" data-f="' + fi + '" ' +
                 'style="cursor:pointer;border-top:1px dashed var(--line);">' +
                 '<span class="lg-swatch" style="background:' + hex + ';"></span>' +
                 '<span class="fs-13" style="width:42px;">' + App.escapeHtml(fd.floor) + ' 层</span>' +
                 '<span class="rate-bar flex-grow-1"><i style="width:' + fd.rate + '%;background:' + hex + ';"></i></span>' +
                 '<span class="fs-12 text-muted-2" style="width:52px;text-align:right;">' + fd.rate + '%</span>' +
               '</div>';
      }).join('');

      return '<div class="' + (bi > 0 ? 'mt-3' : '') + '">' +
               '<div class="d-flex justify-content-between align-items-center">' +
                 '<span class="fw-bold" style="font-size:14.5px;">' + App.escapeHtml(b.name) + '</span>' +
                 '<span class="badge-status ' + st.badge + '"><span class="dot"></span>' + b.rate + '%</span>' +
               '</div>' +
               '<div class="fs-12 text-muted-2">' + b.floorList.length + ' 个楼层 · 共 ' + b.seats + ' 座 · 已用 ' + b.used + ' 座</div>' +
               rows +
             '</div>';
    }).join('');

    $('#buildingList').html(html);
  }

  /* ------------------------------ 渲染循环 ------------------------------ */

  function animate() {
    animId = window.requestAnimationFrame(animate);
    if (controls) controls.update();
    if (renderer && scene && camera) renderer.render(scene, camera);
  }

  function onResize() {
    if (!ready) return;
    var w = $wrap.width();
    var h = $wrap.height();
    if (w <= 0 || h <= 0) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }

  /* ------------------------------ 数据加载 ------------------------------ */

  function loadRooms() {
    // 三维页位于 three-d/ 子目录，数据文件在项目根目录的 data/ 下，需用 ../ 回退一级
    App.loadJSON('../data/rooms.json').done(function (res) {
      var rooms = (res && res.rooms) || [];
      $('#updateTime').text((res && res.updateTime) || '--');

      if (rooms.length === 0) {
        App.showAlert($alertHost, 'warn', '<strong>数据为空</strong><br>data/rooms.json 中没有自习室记录，无法生成三维模型。');
        App.renderEmpty($wrap, '暂无自习室数据', '数据文件为空，无法构建立体模型。');
        $status.text('暂无数据');
        $('#buildingList').html('<div class="text-muted-2 fs-13">暂无数据。</div>');
        return;
      }

      buildings = groupByBuilding(rooms);

      if (!initScene()) return;
      buildModel();
      animate();

      App.showAlert($alertHost, 'ok',
        '<strong>三维模型已就绪</strong> 已按 ' + buildings.length + ' 栋楼宇、' + rooms.length +
        ' 间自习室的座位数据生成彩色立方体，点击立方体或右侧楼层列表可查看占用情况。');
    }).fail(function (jqXHR, textStatus) {
      var info = App.describeError(jqXHR, textStatus);
      App.showAlert($alertHost, 'error', '<strong>自习室数据加载失败：' + App.escapeHtml(info.title) + '</strong><br>' + App.escapeHtml(info.desc));
      $('#buildingList').html('<div class="text-danger fs-13">数据加载失败，无法生成三维模型。</div>');
      showFatal(info.title, info.desc);
    });
  }

  /* ------------------------------ 事件绑定 ------------------------------ */

  $(function () {
    $('#btnResetView').on('click', function () {
      resetView();
      App.toast('视角已复位', 'info');
    });

    $('#btnRotate').on('click', function () {
      if (!controls) return;
      controls.autoRotate = !controls.autoRotate;
      controls.autoRotateSpeed = 1.8;
      $(this).toggleClass('active', controls.autoRotate);
      App.toast(controls.autoRotate ? '已开启自动旋转' : '已关闭自动旋转', 'info');
    });

    // 侧边列表点击 -> 视角对准该楼层的立方体
    $('#buildingList').on('click', '.js-floor', function () {
      var bi = safeInt($(this).data('b'), -1);
      var fi = safeInt($(this).data('f'), -1);
      var b = buildings[bi];
      if (!b) return;
      var fd = b.floorList[fi];
      if (!fd) return;

      // 立方体在 cubes 数组中的顺序与构建顺序一致，这里按 楼宇/楼层 反查
      var idx = 0;
      for (var i = 0; i < bi; i++) { idx += buildings[i].floorList.length; }
      idx += fi;

      if (cubes[idx]) { focusCube(cubes[idx]); }
      App.toast(b.name + ' ' + fd.floor + 'F：占用率 ' + fd.rate + '%（已用 ' + fd.used + ' / ' + fd.seats + ' 座）', 'info');
    });

    // 鼠标事件
    $wrap.on('mousemove', onPointerMove)
         .on('mousedown', onPointerDown)
         .on('mouseleave', function () {
           if (hovered) { hovered.scale.set(1, 1, 1); hovered = null; }
           $tip.removeClass('show');
         });

    var timer = null;
    $(window).on('resize', function () {
      window.clearTimeout(timer);
      timer = window.setTimeout(onResize, 150);
    });
    $(window).on('beforeunload', function () {
      if (animId) window.cancelAnimationFrame(animId);
    });

    loadRooms();
  });
})(jQuery);