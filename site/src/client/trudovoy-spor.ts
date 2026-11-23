/**
 * Скрипты статьи «Трудовой спор»: подсветка активного пункта оглавления
 * при прокрутке, калькулятор потерь и риска, аккордеон FAQ.
 *
 * Перенесено из инлайн-скриптов trudovoy-spor.html. Аккордеон, который здесь
 * дублировался, оставлен как есть — повторная привязка обработчиков к уже
 * обработанным заголовкам не срабатывает (в script.js сравнение то же самое).
 */
/* ============================================
   СКРИПТЫ СТРАНИЦЫ ТРУДОВОГО СПОРА
   ============================================ */

/* --- Активный пункт оглавления при скролле --- */
(function() {
  var tocLinks = document.querySelectorAll('.article-toc-list a');
  var sections = [];

  tocLinks.forEach(function(link) {
    var id = link.getAttribute('href').replace('#', '');
    var el = document.getElementById(id);
    if (el) sections.push({ id: id, el: el, link: link });
  });

  function updateToc() {
    var scrollPos = window.scrollY + 120;
    var current = '';

    sections.forEach(function(s) {
      if (s.el.offsetTop <= scrollPos) {
        current = s.id;
      }
    });

    tocLinks.forEach(function(link) {
      link.classList.remove('active');
    });

    sections.forEach(function(s) {
      if (s.id === current) {
        s.link.classList.add('active');
      }
    });
  }

  window.addEventListener('scroll', updateToc, { passive: true });
  updateToc();
})();

/* --- Счётчик победных цифр --- */
(function() {
  var counters = document.querySelectorAll('.article-win-number[data-count]');
  if (!counters.length || !('IntersectionObserver' in window)) return;

  var obs = new IntersectionObserver(function(entries) {
    entries.forEach(function(entry) {
      if (!entry.isIntersecting) return;
      var el = entry.target;
      var target = parseInt(el.getAttribute('data-count'));
      var start = performance.now();
      var duration = 1500;

      function update(now) {
        var progress = Math.min((now - start) / duration, 1);
        var eased = 1 - Math.pow(1 - progress, 3);
        el.textContent = Math.floor(eased * target);
        if (progress < 1) requestAnimationFrame(update);
      }
      requestAnimationFrame(update);
      obs.unobserve(el);
    });
  }, { threshold: 0.5 });

  counters.forEach(function(c) { obs.observe(c); });
})();

/* --- Интерактивный чек-лист оценки риска --- */
var riskScore = 0;

function toggleRisk(item) {
  item.classList.toggle('checked');
  var weight = parseInt(item.getAttribute('data-weight')) || 1;

  if (item.classList.contains('checked')) {
    riskScore += weight;
  } else {
    riskScore -= weight;
  }

  riskScore = Math.max(0, riskScore);

  var checkedCount = document.querySelectorAll('.risk-item.checked').length;
  document.getElementById('risk-count').textContent = checkedCount;

  // Яндекс.Метрика: событие использования чек-листа
  if (typeof ym !== 'undefined') {
    ym(108237323, 'reachGoal', 'risk_checker_used', { checked: checkedCount, score: riskScore });
  }

  updateRiskResult(riskScore, checkedCount);
}

function updateRiskResult(score, count) {
  var result = document.getElementById('risk-result');
  var title = document.getElementById('risk-result-title');
  var text = document.getElementById('risk-result-text');

  if (count === 0) {
    result.classList.remove('visible');
    return;
  }

  result.classList.add('visible');

  if (score <= 2) {
    result.className = 'risk-result visible low';
    title.textContent = '✅ Низкий риск';
    text.textContent = 'Признаков незаконного давления немного. Тем не менее продолжайте фиксировать всё письменно и знайте свои права — ситуация может измениться быстро.';
  } else if (score <= 6) {
    result.className = 'risk-result visible medium';
    title.textContent = '⚠️ Средний риск — действуйте сейчас';
    text.textContent = 'Признаки давления есть. Начните фиксировать всё письменно прямо сегодня. Изучите свои права и будьте готовы к жалобе в ГИТ. Рекомендую консультацию специалиста.';
  } else {
    result.className = 'risk-result visible high';
    title.textContent = '🚨 Высокий риск — срочно обратитесь за помощью';
    text.textContent = 'У вас явные признаки незаконных действий работодателя. Не медлите: фиксируйте нарушения, подавайте жалобу в ГИТ и прокуратуру. Я прошла через это — знаю, как действовать. Позвоните прямо сейчас.';
  }
}

/* --- Калькулятор компенсации --- */
function formatNum(n) {
  return Math.round(n).toLocaleString('ru-RU') + ' ₽';
}

function updateCalc() {
  var salary = parseInt(document.getElementById('calc-salary').value);
  var months = parseInt(document.getElementById('calc-months').value);
  var moral = parseInt(document.getElementById('calc-moral').value);

  // Обновляем отображение значений слайдеров
  document.getElementById('calc-salary-display').textContent = salary.toLocaleString('ru-RU');
  document.getElementById('calc-months-display').textContent = months;
  document.getElementById('calc-moral-display').textContent = moral.toLocaleString('ru-RU');

  // Расчёты
  var lostSalary = salary * months;
  var expenses = 15000; // Средние судебные расходы
  var total = lostSalary + moral + expenses;

  // Обновляем результаты
  document.getElementById('calc-lost-salary').textContent = formatNum(lostSalary);
  document.getElementById('calc-moral-out').textContent = formatNum(moral);
  document.getElementById('calc-expenses').textContent = '~ ' + formatNum(expenses);
  document.getElementById('calc-total').textContent = formatNum(total);

  // Обновляем фон ползунков
  updateSliderFill('calc-salary', 20000, 200000);
  updateSliderFill('calc-months', 1, 18);
  updateSliderFill('calc-moral', 5000, 100000);
}

function updateSliderFill(id, min, max) {
  var slider = document.getElementById(id);
  if (!slider) return;
  var pct = ((slider.value - min) / (max - min)) * 100;
  slider.style.background = 'linear-gradient(to right, #4ade80 0%, #4ade80 ' + pct + '%, #333333 ' + pct + '%, #333333 100%)';
}

// Инициализация калькулятора при загрузке
document.addEventListener('DOMContentLoaded', function() {
  updateCalc();
});

/* --- Событие Метрики: прочитана статья до конца --- */
(function() {
  if (!('IntersectionObserver' in window)) return;

  var postscript = document.getElementById('postscript');
  if (!postscript) return;

  var obs = new IntersectionObserver(function(entries) {
    entries.forEach(function(entry) {
      if (entry.isIntersecting) {
        if (typeof ym !== 'undefined') {
          ym(108237323, 'reachGoal', 'article_read_to_end');
        }
        obs.unobserve(entry.target);
      }
    });
  }, { threshold: 0.3 });

  obs.observe(postscript);
})();

/* --- Событие Метрики: клик по телефону --- */
document.querySelectorAll('a[href^="tel:"]').forEach(function(link) {
  link.addEventListener('click', function() {
    if (typeof ym !== 'undefined') {
      ym(108237323, 'reachGoal', 'phone_click_article');
    }
  });
});

/* --- Событие Метрики: использование калькулятора --- */
['calc-salary', 'calc-months', 'calc-moral'].forEach(function(id) {
  var el = document.getElementById(id);
  if (!el) return;
  var tracked = false;
  el.addEventListener('input', function() {
    if (!tracked) {
      if (typeof ym !== 'undefined') {
        ym(108237323, 'reachGoal', 'calc_used_article');
      }
      tracked = true;
    }
  });
});

/* --- Аккордеон FAQ (дублирует логику из script.js, но для data-expanded) --- */
document.querySelectorAll('.accordion-header').forEach(function(btn) {
  btn.addEventListener('click', function() {
    var item = this.parentElement;
    var isActive = item.classList.contains('active');
    var siblings = item.parentElement.querySelectorAll('.accordion-item');

    siblings.forEach(function(s) {
      s.classList.remove('active');
      var h = s.querySelector('.accordion-header');
      if (h) h.setAttribute('aria-expanded', 'false');
    });

    if (!isActive) {
      item.classList.add('active');
      this.setAttribute('aria-expanded', 'true');

      // Метрика: открыт FAQ
      if (typeof ym !== 'undefined') {
        ym(108237323, 'reachGoal', 'faq_opened', {
          question: this.textContent.trim().substring(0, 50)
        });
      }
    }
  });
});

(function() {
    // Ждём полной загрузки элементов
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', runAccordion);
    } else {
      runAccordion();
    }

    function runAccordion() {
      var headers = document.querySelectorAll('.accordion-header');
      for (var i = 0; i < headers.length; i++) {
        headers[i].addEventListener('click', function(e) {
          e.preventDefault(); // Отменяем стандартное поведение кнопки
          
          var item = this.closest('.accordion-item');
          var isActive = item.classList.contains('active');
          
          // Закрываем все остальные вопросы
          var allItems = document.querySelectorAll('.accordion-item');
          for (var j = 0; j < allItems.length; j++) {
            allItems[j].classList.remove('active');
          }
          
          // Если кликнутый был закрыт — открываем его
          if (!isActive) {
            item.classList.add('active');
            this.setAttribute('aria-expanded', 'true');
          } else {
            this.setAttribute('aria-expanded', 'false');
          }
        });
      }
    }
  })();