/* "New job" form: find an existing customer as you type, or add a new one. */
(function () {
  'use strict';

  var picker = document.querySelector('[data-picker]');
  if (!picker) return;

  var idInput = picker.querySelector('[data-picker-id]');
  var searchBox = picker.querySelector('[data-picker-search]');
  var input = picker.querySelector('[data-picker-input]');
  var results = picker.querySelector('[data-picker-results]');
  var pickedBox = picker.querySelector('[data-picker-picked]');
  var newBox = picker.querySelector('[data-picker-new]');
  var newName = newBox.querySelector('[name="new_customer_name"]');
  var options = [];
  var active = -1;
  var timer = null;
  var requestNo = 0;

  function show(mode) {
    searchBox.hidden = mode !== 'search';
    pickedBox.hidden = mode !== 'picked';
    newBox.hidden = mode !== 'new';
    newName.required = mode === 'new';
    closeResults();
  }

  function closeResults() {
    results.hidden = true;
    results.textContent = '';
    input.setAttribute('aria-expanded', 'false');
    options = [];
    active = -1;
  }

  function setActive(index) {
    active = index;
    Array.prototype.forEach.call(results.children, function (li, i) {
      li.classList.toggle('active', i === index);
      li.setAttribute('aria-selected', i === index ? 'true' : 'false');
    });
  }

  function choose(option) {
    if (option.add) {
      idInput.value = '';
      newName.value = option.name;
      show('new');
      (option.name ? newBox.querySelector('[name="new_customer_phone"]') : newName).focus();
      return;
    }
    idInput.value = option.id;
    pickedBox.querySelector('[data-picked-name]').textContent = option.name;
    pickedBox.querySelector('[data-picked-contact]').textContent = [option.phone, option.email].filter(Boolean).join(' · ');
    show('picked');
    var next = document.getElementById('device_type');
    if (next) next.focus();
  }

  function render(customers, query) {
    options = customers.concat([{ add: true, name: query }]);
    results.textContent = '';
    options.forEach(function (option, index) {
      var li = document.createElement('li');
      li.setAttribute('role', 'option');
      if (option.add) {
        li.className = 'add';
        li.textContent = '+ Add “' + query + '” as a new customer';
      } else {
        li.textContent = option.name;
        var contact = [option.phone, option.email].filter(Boolean).join(' · ');
        if (contact) {
          var span = document.createElement('span');
          span.textContent = contact;
          li.appendChild(span);
        }
      }
      li.addEventListener('mousedown', function (event) {
        event.preventDefault(); // keep focus so the click is not lost
        choose(option);
      });
      li.addEventListener('mouseenter', function () {
        setActive(index);
      });
      results.appendChild(li);
    });
    results.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    setActive(0);
  }

  function search() {
    var query = input.value.trim();
    if (!query) {
      closeResults();
      return;
    }
    var mine = ++requestNo;
    fetch('/api/customers?q=' + encodeURIComponent(query), { headers: { Accept: 'application/json' } })
      .then(function (response) {
        return response.ok ? response.json() : [];
      })
      .catch(function () {
        return [];
      })
      .then(function (customers) {
        if (mine === requestNo && input.value.trim() === query) render(customers, query);
      });
  }

  input.addEventListener('input', function () {
    clearTimeout(timer);
    timer = setTimeout(search, 140);
  });

  input.addEventListener('keydown', function (event) {
    if (event.key === 'Enter') {
      event.preventDefault(); // never submit the whole form from the search box
      if (options[active]) choose(options[active]);
      else if (input.value.trim()) search();
    } else if (event.key === 'ArrowDown' && options.length) {
      event.preventDefault();
      setActive((active + 1) % options.length);
    } else if (event.key === 'ArrowUp' && options.length) {
      event.preventDefault();
      setActive((active - 1 + options.length) % options.length);
    } else if (event.key === 'Escape') {
      closeResults();
    }
  });

  input.addEventListener('blur', function () {
    setTimeout(closeResults, 120);
  });

  input.addEventListener('focus', function () {
    if (input.value.trim()) search();
  });

  picker.querySelectorAll('[data-picker-change]').forEach(function (button) {
    button.addEventListener('click', function () {
      idInput.value = '';
      newBox.querySelectorAll('input, textarea').forEach(function (field) {
        field.value = '';
      });
      input.value = '';
      show('search');
      input.focus();
    });
  });

  show(picker.getAttribute('data-mode') || 'search');
})();
