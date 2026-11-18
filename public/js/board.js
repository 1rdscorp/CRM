/* Job board: drag a card to another column to change the job's status. */
(function () {
  'use strict';

  var board = document.getElementById('board');
  if (!board) return;
  var csrf = document.querySelector('meta[name="csrf-token"]').content;
  var dragged = null;

  function clearTargets() {
    board.querySelectorAll('.drop-target').forEach(function (col) {
      col.classList.remove('drop-target');
    });
  }

  // Re-read the page quietly so counts and buttons match the saved data.
  function refresh() {
    return fetch(window.location.href, { headers: { Accept: 'text/html' } })
      .then(function (response) {
        return response.text();
      })
      .then(function (html) {
        var fresh = new DOMParser().parseFromString(html, 'text/html');
        ['#board', '.chips', '.page-head .sub'].forEach(function (selector) {
          var from = fresh.querySelector(selector);
          var to = document.querySelector(selector);
          if (from && to) to.innerHTML = from.innerHTML;
        });
      });
  }

  board.addEventListener('dragstart', function (event) {
    var card = event.target.closest('.job-card');
    if (!card) return;
    dragged = card;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', card.getAttribute('data-job-id'));
    setTimeout(function () {
      card.classList.add('dragging');
    }, 0);
  });

  board.addEventListener('dragend', function () {
    if (dragged) dragged.classList.remove('dragging');
    dragged = null;
    clearTargets();
  });

  board.addEventListener('dragover', function (event) {
    var col = event.target.closest('.board-col');
    if (!col || !dragged) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    if (!col.classList.contains('drop-target')) {
      clearTargets();
      if (col !== dragged.closest('.board-col')) col.classList.add('drop-target');
    }
  });

  board.addEventListener('drop', function (event) {
    var col = event.target.closest('.board-col');
    if (!col || !dragged) return;
    event.preventDefault();
    var card = dragged;
    clearTargets();
    if (col === card.closest('.board-col')) return;

    var placeholder = col.querySelector('.board-empty');
    if (placeholder) placeholder.remove();
    col.querySelector('.board-list').appendChild(card);

    fetch('/jobs/' + card.getAttribute('data-job-id') + '/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-Token': csrf },
      body: JSON.stringify({ status: col.getAttribute('data-status') }),
    })
      .then(function (response) {
        if (!response.ok) throw new Error('Status change failed');
        return refresh();
      })
      .catch(function () {
        window.location.reload();
      });
  });
})();
