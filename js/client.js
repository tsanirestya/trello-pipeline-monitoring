/* global TrelloPowerUp */
(function () {
  'use strict';

  // Absolute base URL of this Power-Up (Trello needs absolute icon URLs).
  var BASE = window.location.href.replace(/[^/]*$/, '');
  var ICON = BASE + 'icon.svg';

  TrelloPowerUp.initialize({
    'board-buttons': function (t) {
      return [{
        icon: { dark: ICON, light: ICON },
        text: 'Pipeline Monitor',
        callback: function (t) {
          return t.modal({
            url: './dashboard.html',
            title: 'Pipeline Monitor — Region × Stage',
            fullscreen: true,
            accentColor: '#0c66e4'
          });
        }
      }];
    }
  }, {
    appKey: TRELLO_APP_KEY,
    appName: TRELLO_APP_NAME
  });
})();
