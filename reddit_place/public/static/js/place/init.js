!r.placeModule('init', function(require) {
  var $ = require('jQuery');
  var r = require('r');

  var Activity = require('activity');
  var AudioManager = require('audio');
  var bindEvents = require('utils').bindEvents;
  var Camera = require('camera');
  var CameraButton = require('camerabutton');
  var CameraButtonEvents = require('camerabuttonevents');
  var CameraEvents = require('cameraevents');
  var CanvasEvents = require('canvasevents');
  var Canvasse = require('canvasse');
  var Client = require('client');
  var Cursor = require('cursor');
  var Hand = require('hand');
  var Inspector = require('inspector');
  var MollyGuard = require('mollyguard');
  var MuteButton = require('mutebutton');
  var MuteButtonEvents = require('mutebuttonevents');
  var Notifications = require('notifications');
  var Palette = require('palette');
  var PaletteEvents = require('paletteevents');
  var R2Server = require('api');
  var Timer = require('timer');
  var WebsocketEvents = require('websocketevents');
  var ZoomButton = require('zoombutton');
  var ZoomButtonEvents = require('zoombuttonevents');
  var NotificationButton = require('notificationbutton');
  var NotificationButtonEvents = require('notificationbuttonevents');

  /**
   * Utility for kicking off an animation frame loop.
   * @function
   * @param {function} fn The function to call on each frame
   * @returns {number} An id, used to cancel with cancelAnimationFrame
   */
  function startTicking(fn) {
    return requestAnimationFrame(function tick() {
      fn();
      requestAnimationFrame(tick);
    });
  }

  // Init code:
  $(function() {
    var activeVisitors = r.config.place_active_visitors;
    var isFullscreen = r.config.place_fullscreen;
    var isUiHidden = r.config.place_hide_ui;
    var isUserLoggedIn = r.config.logged;
    var canvasWidth = r.config.place_canvas_width;
    var canvasHeight = r.config.place_canvas_height;
    var cooldownDuration = 1000 * r.config.place_cooldown;
    var websocketUrl = r.config.place_websocket_url;



    var container = document.getElementById('place-container');

    // Bail out early if the container element isn't found – we're probably
    // running on some other page in r/place that doesn't have the canvas.
    if (!container) { return; }

    var activityCount = document.getElementById('place-activity-count');
    var viewer = document.getElementById('place-viewer');
    var camera = document.getElementById('place-camera');
    var cameraButton = document.getElementById('place-camera-button');
    var canvas = document.getElementById('place-canvasse');
    var palette = document.getElementById('place-palette');
    var hand = document.getElementById('place-hand');
    var inspector = document.getElementById('place-inspector');
    var handSwatch = document.getElementById('place-hand-swatch');
    var mollyGuard = document.getElementById('place-molly-guard');
    var muteButton = document.getElementById('place-mute-button');
    var zoomButton = document.getElementById('place-zoom-button');
    var notificationButton = document.getElementById('place-notification-button');
    var timer = document.getElementById('place-timer');

    function resizeToWindow() {
      $(container).css({
        height: window.innerHeight,
        width: window.innerWidth,
      });
    }

    if (isFullscreen) {
      resizeToWindow();
      $(window).on('resize', resizeToWindow);
    }

    Activity.init(activityCount, activeVisitors);
    AudioManager.init();
    Camera.init(viewer, camera);

    // Hack to fix slightly older versions of Safari, where the viewer element
    // defaults to fitting within the container width.
    $(viewer).css({
      flex: '0 0 ' + canvasWidth + 'px',
    });

    // Allow passing in starting camera position in the url hash
    var locationHash = window.location.hash.replace(/^#/, '');
    var hashParams = r.utils.parseQueryString(locationHash);


    Canvasse.init(canvas, canvasWidth, canvasHeight);
    CameraButton.init(cameraButton);
    Hand.init(hand, handSwatch);
    Inspector.init(inspector);

    if (isUserLoggedIn && !isUiHidden) {
      Palette.init(palette);
    }

    if (!isUiHidden) {
      MollyGuard.init(mollyGuard);
      if (AudioManager.isSupported) {
        MuteButton.init(muteButton);
      }
      ZoomButton.init(zoomButton);
    }
    Timer.init(timer);
    Notifications.init();

    // Clamp starting coordinates to the canvas boundries
    var halfWidth = canvasWidth / 2;
    var halfHeight = canvasHeight / 2;
    var startX = Math.max(0, Math.min(canvasWidth, hashParams.x || halfWidth));
    var startY = Math.max(0, Math.min(canvasHeight, hashParams.y || halfHeight));

    // Convert those values to canvas transform offsets
    // TODO - this shouldn't be done here, it requires Canvasse.init to be called first
    var startOffsets = Client.getOffsetFromCameraLocation(startX, startY);

    Client.init(isUserLoggedIn, cooldownDuration, startOffsets.x, startOffsets.y);

    // Some browsers (Safari, Edge) have a blurry canvas problem due to
    // lack of proper support for the 'image-rendering' css rule, which is
    // what allows us to scale up the canvas without bilinear interpolation.
    // We can still upscale correctly by drawing the small canvas into a bigger
    // canvas using the imageSmoothingEnabled flag.
    var canvasDiv = null;
    var displayCanvas = null;
    var displayCtx = null;
    var usingBlurryCanvasFix = false;

    // Only apply to browsers where this is a known issue.
    var isSafari = (window.navigator.userAgent.indexOf('Safari') > -1 &&
                    window.navigator.userAgent.indexOf('Chrome') === -1);
    // Necessary to catch webview embedded in native iOS app
    var isIOS = (window.navigator.userAgent.indexOf('iOS') > -1 ||
                 window.navigator.userAgent.indexOf('iPhone') > -1 ||
                 window.navigator.userAgent.indexOf('iPad') > -1);
    var isEdge = window.navigator.userAgent.indexOf('Edge') > -1;
    if (isSafari || isIOS || isEdge) {
      usingBlurryCanvasFix = true;
      // To avoid having to redo event work, we just let the existing canvas
      // element sit there invisibly.
      $(Canvasse.el).css({ opacity: 0 });
      displayCanvas = document.createElement('canvas');
      displayCtx = displayCanvas.getContext('2d');
      $(displayCanvas).addClass('place-display-canvas');
      $(container).prepend(displayCanvas);
      resizeDisplayCanvas();
    }

    function resizeDisplayCanvas() {
      var containerRect = container.getBoundingClientRect();
      displayCanvas.width = containerRect.width;
      displayCanvas.height = containerRect.height;
      // Here's the magic.  These flags are reset any time the canvas resize
      // changes, so they need to be set here.
      displayCtx.mozImageSmoothingEnabled = false;
      displayCtx.webkitImageSmoothingEnabled = false;
      displayCtx.msImageSmoothingEnabled = false;
      displayCtx.imageSmoothingEnabled = false;
      redrawDisplayCanvas();
    }

    function redrawDisplayCanvas() {
      displayCtx.clearRect(0, 0, displayCanvas.width, displayCanvas.height);
      displayCtx.drawImage(
        Canvasse.el,
        // Center the canvas, then apply the current pan offset.  The half pixel
        // css it necessary to match the same offset applied to the real canvas
        // via a css transform.
        (displayCanvas.width / 2) + (Client._panX - halfWidth - .5) * Client._zoom,
        (displayCanvas.height / 2) + (Client._panY - halfHeight - .5) * Client._zoom,
        Canvasse.width * Client._zoom,
        Canvasse.height * Client._zoom
      );
    }

    bindEvents(window, {
      'resize': function() {
        resizeDisplayCanvas();
      },
    });

    R2Server.getCanvasBitmapState().then(function(timestamp, canvas) {
      // TODO - request non-cached version if the timestamp is too old
      if (!canvas) { return; }
      Client.setInitialState(canvas);
      if (usingBlurryCanvasFix) {
        redrawDisplayCanvas();
      }
    });

    var websocket = new r.WebSocket(websocketUrl);
    websocket.on(WebsocketEvents);
    websocket.start();

    // TODO - fix this weird naming?
    bindEvents(container, CameraEvents['container']);
    bindEvents(document, CameraEvents['document']);
    bindEvents(camera, CanvasEvents);
    bindEvents(cameraButton, CameraButtonEvents);
    bindEvents(muteButton, MuteButtonEvents);
    bindEvents(zoomButton, ZoomButtonEvents);
    bindEvents(notificationButton, NotificationButtonEvents);

    if (isUserLoggedIn) {
      bindEvents(palette, PaletteEvents);
    }

    function shouldMouseOutCancel(e) {
      // Events are stupid
      return !(e.target === camera || e.relatedTarget === camera) && Cursor.isDown;
    }

    bindEvents(container, {
      'mouseout': function(e) {
        if (shouldMouseOutCancel(e)) {
          return CameraEvents['container']['mouseup'](e);
        }
      },

      // Map touch events to mouse events.  Note that this works since
      // currently the event handlers only use the clientX and clientY
      // properties of the MouseEvent objects (which the Touch objects
      // also have.  If the handlers start using other properties or
      // methods of the MouseEvent that the Touch objects *don't* have,
      // this will probably break.
      'touchstart': function(e) {
        if (!Cursor.isUsingTouch) {
          Cursor.setTouchMode(true);
        }
        return CameraEvents['container']['mousedown'](e.changedTouches[0]);
      },

      'touchmove': function(e) {
        e.preventDefault();
        return CameraEvents['container']['mousemove'](e.changedTouches[0]);
      },

      'touchend': function(e) {
        return CameraEvents['container']['mouseup'](e.changedTouches[0]);
      },

      'touchcancel': function(e) {
        if (shouldMouseOutCancel(e)) {
          return CameraEvents['container']['mouseup'](e.changedTouches[0]);
        }
      },
    });

    bindEvents(palette, {
      'touchstart': function(e) {
        if (!Cursor.isUsingTouch) {
          Cursor.setTouchMode(true);
        }
      },
    });

    // Move the camera if the hash params changedTouches
    bindEvents(window, {
      'hashchange': function(e) {
        var locationHash = window.location.hash.replace(/^#/, '');
        var hashParams = r.utils.parseQueryString(locationHash);

        if (hashParams.x && hashParams.y) {
          Client.interact();
          Client.setCameraLocation(hashParams.x, hashParams.y);
        }
      },
    });

    startTicking(function() {
      Client.tick();
      Cursor.tick();
      var cameraDidUpdate = Camera.tick();
      var canvasDidUpdate = Canvasse.tick();

      if (usingBlurryCanvasFix && (cameraDidUpdate || canvasDidUpdate)) {
        redrawDisplayCanvas();
      }
    });

    r.place = Client;
    r.hooks.call('place.init');
  });
});
