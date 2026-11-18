/* Small behaviours shared by every page. No framework, no build step. */
(function () {
  'use strict';

  // Tell the server which time zone we are in, so "today" is always right.
  try {
    var tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz && document.cookie.indexOf('tz=' + encodeURIComponent(tz)) === -1) {
      document.cookie = 'tz=' + encodeURIComponent(tz) + '; path=/; max-age=31536000; samesite=lax';
    }
  } catch (err) {
    /* the server falls back to its own time zone */
  }

  // Ask before destructive actions, and stop double-clicks sending a form twice.
  document.addEventListener('submit', function (event) {
    var form = event.target;
    var question = form.getAttribute('data-confirm');
    if (question && !window.confirm(question)) {
      event.preventDefault();
      return;
    }
    var button = event.submitter;
    if (!button) return;
    var busyText = button.getAttribute('data-busy-text') || form.getAttribute('data-busy-text');
    // Wait a tick so the button's own name/value is still sent with the form.
    setTimeout(function () {
      if (event.defaultPrevented) return;
      button.disabled = true;
      if (busyText) {
        button.setAttribute('data-idle-text', button.textContent);
        button.textContent = busyText;
      }
    }, 0);
  });

  // Coming back with the browser's Back button: wake the buttons up again.
  window.addEventListener('pageshow', function () {
    document.querySelectorAll('button[disabled]').forEach(function (button) {
      button.disabled = false;
      var idle = button.getAttribute('data-idle-text');
      if (idle) button.textContent = idle;
    });
  });

  document.addEventListener('click', function (event) {
    var target = event.target;

    if (target.closest('[data-print]')) {
      window.print();
      return;
    }

    var opener = target.closest('[data-open-dialog]');
    if (opener) {
      var dialog = document.getElementById(opener.getAttribute('data-open-dialog'));
      if (dialog && dialog.showModal) dialog.showModal();
      return;
    }

    if (target.closest('[data-close-dialog]')) {
      var open = target.closest('dialog');
      if (open) open.close();
      return;
    }

    // Clicking the dark area around a dialog closes it.
    if (target.tagName === 'DIALOG' && target.open) {
      var box = target.getBoundingClientRect();
      var inside =
        event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
      if (!inside) target.close();
      return;
    }

    // Whole table rows are clickable.
    var row = target.closest('tr[data-href]');
    if (row && !target.closest('a, button, input, select, label, form')) {
      if (String(window.getSelection())) return; // the user is selecting text
      window.location.href = row.getAttribute('data-href');
    }
  });

  // Logo upload: shrink the chosen picture in the browser and send it as a PNG.
  var logoForm = document.querySelector('[data-logo-form]');
  if (logoForm) {
    var fileInput = logoForm.querySelector('[data-logo-file]');
    var dataInput = logoForm.querySelector('[data-logo-data]');
    var message = document.querySelector('[data-logo-error]');
    var MAX_W = 720;
    var MAX_H = 280;

    var fail = function (text) {
      if (message) {
        message.textContent = text;
        message.style.color = 'var(--danger)';
      }
    };

    logoForm.querySelector('[data-logo-pick]').addEventListener('click', function () {
      fileInput.click();
    });

    fileInput.addEventListener('change', function () {
      var file = fileInput.files && fileInput.files[0];
      if (!file) return;
      var url = URL.createObjectURL(file);
      var image = new Image();
      image.onload = function () {
        var width = image.naturalWidth || 600;
        var height = image.naturalHeight || 240;
        var scale = Math.min(1, MAX_W / width, MAX_H / height);
        var canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        try {
          dataInput.value = canvas.toDataURL('image/png');
        } catch (err) {
          fail('That picture could not be read. Try a PNG or JPG file.');
          return;
        }
        logoForm.submit();
      };
      image.onerror = function () {
        URL.revokeObjectURL(url);
        fail('That file is not a picture this browser can read. Try a PNG or JPG file.');
      };
      image.src = url;
    });
  }
})();
