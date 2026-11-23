/**
 * Клиентские скрипты сайта kadry-pro.ru.
 *
 * Здесь собрано всё, что раньше лежало в script.js и подключалось на каждой
 * странице: декоративный фон, поведение шапки, мобильное меню, плавные якоря,
 * появление блоков при прокрутке, счётчики, калькулятор, табы, FAQ-аккордеон,
 * маска телефона, фильтр кейсов, нижняя плашка.
 *
 * Сознательно вырезано:
 *  • искусственный прелоадер (задерживал показ страницы на 300–3000 мс);
 *  • отправка заявок в Formspree — этим занимается leads-form.ts (Агент 03);
 *  • самодельный куки-баннер — его заменил честный consent.ts (Агент 02).
 */

/* ============================================
   ДЕКОРАТИВНЫЙ ФОН — динамическая инъекция
   (сокращает HTML на ~250 строк на странице)
   ============================================ */
function initBgDecor() {
  var container = document.getElementById('bg-decor');
  if (!container) return;
  container.setAttribute('aria-hidden', 'true');
  
  var html = '';
  
  // Мягкие шёлковые ленты Северного сияния (вместо цифр, иконок и линеек)
  html += '<div class="bg-decor-aurora bg-decor-aurora--1"></div>';
  html += '<div class="bg-decor-aurora bg-decor-aurora--2"></div>';
  html += '<div class="bg-decor-aurora bg-decor-aurora--3"></div>';
  
  container.innerHTML = html;
}

document.addEventListener('DOMContentLoaded', function () {
  initBgDecor();

  /* Spotlight: деликатный блик Авроры в точке курсора на карточках.
     Только для точного указателя; обработчик пассивный, пишет лишь
     CSS-переменные --spot-x / --spot-y (см. style.css). */
  if (window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    document.addEventListener('pointermove', function (e) {
      var t = e.target;
      var el = t && t.closest ? t.closest('.card, .template-tile') : null;
      if (!el) return;
      var r = el.getBoundingClientRect();
      el.style.setProperty('--spot-x', (e.clientX - r.left) + 'px');
      el.style.setProperty('--spot-y', (e.clientY - r.top) + 'px');
    }, { passive: true });
  }

  /* Прелоадер удалён: страница видна сразу, без искусственной задержки. */

  var nav = document.querySelector('.nav');
  if (nav) {
    window.addEventListener('scroll', function() {
      if (window.scrollY > 20) {
        nav.classList.add('scrolled');
      } else {
        nav.classList.remove('scrolled');
      }
    }, { passive: true });
  }

  var hamburger = document.querySelector('.hamburger');
  var mobileMenu = document.querySelector('.mobile-menu');
  if (hamburger && mobileMenu) {
    hamburger.addEventListener('click', function() {
      hamburger.classList.toggle('active');
      mobileMenu.classList.toggle('active');
      if (mobileMenu.classList.contains('active')) {
        document.body.style.overflow = 'hidden';
      } else {
        document.body.style.overflow = '';
      }
    });
    var mobileLinks = mobileMenu.querySelectorAll('a');
    for (var i = 0; i < mobileLinks.length; i++) {
      mobileLinks[i].addEventListener('click', function() {
        hamburger.classList.remove('active');
        mobileMenu.classList.remove('active');
        document.body.style.overflow = '';
      });
    }
  }

  var anchors = document.querySelectorAll('a[href^="#"]');
  for (var i = 0; i < anchors.length; i++) {
    anchors[i].addEventListener('click', function(e) {
      var href = this.getAttribute('href');
      var target = document.querySelector(href);
      if (target) {
        e.preventDefault();
        var offset = 80;
        var y = target.getBoundingClientRect().top + window.pageYOffset - offset;
        window.scrollTo({ top: y, behavior: 'smooth' });
      }
    });
  }

  var animElements = document.querySelectorAll('.anim');
  if (animElements.length > 0 && 'IntersectionObserver' in window) {
    var observer = new IntersectionObserver(function(entries) {
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].isIntersecting) {
          entries[i].target.classList.add('visible');
          observer.unobserve(entries[i].target);
        }
      }
    }, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });
    for (var i = 0; i < animElements.length; i++) {
      observer.observe(animElements[i]);
    }
  } else {
    for (var i = 0; i < animElements.length; i++) {
      animElements[i].classList.add('visible');
    }
  }

  var counters = document.querySelectorAll('[data-count]');
  if (counters.length > 0 && 'IntersectionObserver' in window) {
    var counterObserver = new IntersectionObserver(function(entries) {
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].isIntersecting) {
          animateCounter(entries[i].target);
          counterObserver.unobserve(entries[i].target);
        }
      }
    }, { threshold: 0.5 });
    for (var i = 0; i < counters.length; i++) {
      counterObserver.observe(counters[i]);
    }
  }

  function animateCounter(el) {
    var target = parseInt(el.getAttribute('data-count'));
    var suffix = el.getAttribute('data-suffix') || '';
    var prefix = el.getAttribute('data-prefix') || '';
    var duration = 2000;
    var start = performance.now();
    function update(now) {
      var elapsed = now - start;
      var progress = Math.min(elapsed / duration, 1);
      var eased = 1 - Math.pow(1 - progress, 3);
      var current = Math.floor(eased * target);
      el.textContent = prefix + current + suffix;
      if (progress < 1) {
        requestAnimationFrame(update);
      }
    }
    requestAnimationFrame(update);
  }

  var salarySlider = document.getElementById('salary-slider');
  var staffSlider = document.getElementById('staff-slider');

  if (salarySlider && staffSlider) {
    var salaryValue = document.getElementById('salary-value');
    var salaryGross = document.getElementById('salary-gross');
    var salaryTax = document.getElementById('salary-tax');
    var salaryTotal = document.getElementById('salary-total');
    var salaryWorkplace = document.getElementById('salary-workplace');
    var staffValue = document.getElementById('staff-value');
    var staffTier = document.getElementById('staff-tier');
    var staffPrice = document.getElementById('staff-price');
    var savingsMonth = document.getElementById('savings-month');
    var savingsYear = document.getElementById('savings-year');

    /* Цены тарифов — из единого prices.json (script#calc-prices на странице).
       Правка цены в /manage/ («Прайс») → пересборка → цифры здесь меняются
       без правки кода. Значения по умолчанию — на случай отсутствия JSON. */
    var tierPrices = { start: 14000, business: 24000, max: 36000 };
    var calcPricesEl = document.getElementById('calc-prices');
    if (calcPricesEl) {
      try {
        var fromJson = JSON.parse(calcPricesEl.textContent || '');
        if (fromJson.start) tierPrices.start = fromJson.start;
        if (fromJson.business) tierPrices.business = fromJson.business;
        if (fromJson.max) tierPrices.max = fromJson.max;
      } catch (e) { /* остаёмся на значениях по умолчанию */ }
    }

    function getTierPrice(count) {
      if (count <= 10) return tierPrices.start;
      if (count <= 30) return tierPrices.business;
      return tierPrices.max;
    }

    function getTierName(count) {
      if (count <= 10) return 'Старт (до 10 чел.)';
      if (count <= 30) return 'Бизнес (11-30 чел.)';
      return 'Максимум (31-50 чел.)';
    }

    function formatNumber(num) {
      return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    }

    function updateRangeFill(slider) {
      var min = parseFloat(slider.min);
      var max = parseFloat(slider.max);
      var val = parseFloat(slider.value);
      var pct = ((val - min) / (max - min)) * 100;
      slider.style.background = 'linear-gradient(to right, var(--accent-secondary) 0%, var(--accent) ' + pct + '%, var(--border-color) ' + pct + '%, var(--border-color) 100%)';
    }

    function updateCalculator() {
      var salary = parseInt(salarySlider.value);
      var staff = parseInt(staffSlider.value);
      var taxRate = 0.302;
      var workplaceCost = 5000;
      // Ползунок — зарплата «на руки»; взносы начисляются на сумму до вычета НДФЛ 13%
      var gross = Math.round(salary / 0.87);
      var tax = Math.round(gross * taxRate);
      var totalEmployer = gross + tax + workplaceCost;
      var tierPrice = getTierPrice(staff);
      var savings = totalEmployer - tierPrice;

      if (salaryValue) salaryValue.textContent = formatNumber(salary);
      if (salaryGross) salaryGross.textContent = formatNumber(gross) + ' \u0440\u0443\u0431.';
      if (salaryTax) salaryTax.textContent = formatNumber(tax) + ' \u0440\u0443\u0431.';
      if (salaryTotal) salaryTotal.textContent = formatNumber(totalEmployer) + ' \u0440\u0443\u0431.';
      if (salaryWorkplace) salaryWorkplace.textContent = formatNumber(workplaceCost) + ' \u0440\u0443\u0431.';
      if (staffValue) staffValue.textContent = staff;
      if (staffTier) staffTier.textContent = getTierName(staff);
      if (staffPrice) staffPrice.textContent = formatNumber(tierPrice) + ' \u0440\u0443\u0431./\u043C\u0435\u0441';
      if (savingsMonth) savingsMonth.textContent = formatNumber(Math.max(0, savings));
      if (savingsYear) savingsYear.textContent = formatNumber(Math.max(0, savings * 12)) + ' \u0440\u0443\u0431. \u0432 \u0433\u043E\u0434';

      updateRangeFill(salarySlider);
      updateRangeFill(staffSlider);
    }

    salarySlider.addEventListener('input', updateCalculator);
    staffSlider.addEventListener('input', updateCalculator);
    updateCalculator();
  }

  var tabNavs = document.querySelectorAll('.tabs-nav');
  for (var n = 0; n < tabNavs.length; n++) {
    (function(tabNav) {
      var buttons = tabNav.querySelectorAll('button');
      var parent = tabNav.closest('.tabs-container') || tabNav.parentElement;
      var contents = parent.querySelectorAll('.tab-content');
      for (var b = 0; b < buttons.length; b++) {
        buttons[b].addEventListener('click', function() {
          var targetId = this.getAttribute('data-tab');
          for (var j = 0; j < buttons.length; j++) {
            buttons[j].classList.remove('active');
          }
          for (var j = 0; j < contents.length; j++) {
            contents[j].classList.remove('active');
          }
          this.classList.add('active');
          var targetContent = parent.querySelector('#' + targetId);
          if (targetContent) targetContent.classList.add('active');
        });
      }
    })(tabNavs[n]);
  }

  var urlParams = new URLSearchParams(window.location.search);
  var tabParam = urlParams.get('tab');
  if (tabParam) {
    var tabBtn = document.querySelector('.tabs-nav button[data-tab="' + tabParam + '"]');
    if (tabBtn) tabBtn.click();
  }

  // 🟢 АККОРДЕОН (FAQ)
document.querySelectorAll('.accordion-header').forEach(function(header) {
  header.addEventListener('click', function(e) {
    e.preventDefault(); // Останавливаем стандартное поведение кнопки
    const item = this.closest('.accordion-item'); // Находим ближайшего родителя-обёртку
    const isActive = item.classList.contains('active');

    // Закрываем все открытые вопросы на странице
    document.querySelectorAll('.accordion-item.active').forEach(function(openItem) {
      openItem.classList.remove('active');
    });

    // Если кликнутый вопрос был закрыт, открываем его
    if (!isActive) {
      item.classList.add('active');
    }
  });
});

  var phoneInputs = document.querySelectorAll('input[data-mask="phone"]');
  for (var i = 0; i < phoneInputs.length; i++) {
    phoneInputs[i].addEventListener('input', function() {
      var val = this.value.replace(/\D/g, '');
      if (val.length > 0 && val[0] === '8') val = '7' + val.slice(1);
      if (val.length > 0 && val[0] !== '7') val = '7' + val;
      var formatted = '';
      if (val.length > 0) formatted = '+7';
      if (val.length > 1) formatted += ' (' + val.slice(1, 4);
      if (val.length > 4) formatted += ') ' + val.slice(4, 7);
      if (val.length > 7) formatted += '-' + val.slice(7, 9);
      if (val.length > 9) formatted += '-' + val.slice(9, 11);
      this.value = formatted;
    });
    phoneInputs[i].addEventListener('focus', function() {
      if (!this.value) this.value = '+7';
    });
    phoneInputs[i].addEventListener('blur', function() {
      if (this.value === '+7') this.value = '';
    });
  }

  /* --- ОТПРАВКА ФОРМ ---
     Раньше все формы уходили в американский Formspree (передача персональных
     данных за границу, нарушение локализации по 152-ФЗ, лимит 50 заявок/мес).
     Теперь отправкой занимается модуль site/src/client/leads-form.ts — зона
     Агента 03 и шлюза relay/: он берёт формы с атрибутом data-lead-form и шлёт
     заявку в Telegram-группу и на почту Марии.

     Этот файл проверяет только поля и согласие, а если модуль заявок ещё не
     подключён — показывает под кнопкой телефон и Telegram, чтобы человек
     точно мог связаться, а не видел «ошибка отправки». */

  /* Формы заявок здесь НЕ обрабатываются: их отправляет leads-form.ts, и только
     он показывает результат. Раньше оба модуля вешали submit на одну и ту же
     форму (проверка флага `leadsBound` не работала — в leads-form.ts он
     называется `leadWired`), и человек получал два противоречащих сообщения:
     «Заявка почти ушла — позвоните» от этого файла и настоящий результат
     следом. Такой дубль и был причиной путаницы в бою.
     Здесь остаётся только подстраховка на случай, если модуль заявок вообще не
     загрузился (сеть, блокировщик): тогда форма без обработчика молча
     перезагрузила бы страницу, и человек не понял бы, ушла заявка или нет. */
  var orphanForms = document.querySelectorAll('form[data-validate]:not([data-lead-form])');
  for (var lf = 0; lf < orphanForms.length; lf++) {
    orphanForms[lf].addEventListener('submit', function (e) {
      e.preventDefault();
      var form = this;
      var status = form.querySelector('.quick-lead-status');
      if (!status) {
        status = document.createElement('p');
        status.className = 'quick-lead-status';
        status.setAttribute('role', 'status');
        status.setAttribute('aria-live', 'polite');
        var submitBtn = form.querySelector('[type="submit"]');
        if (submitBtn && submitBtn.parentNode) {
          submitBtn.parentNode.insertBefore(status, submitBtn.nextSibling);
        } else {
          form.appendChild(status);
        }
      }
      status.hidden = false;
      status.innerHTML = 'Отправка не запустилась. Напишите или позвоните напрямую: ' +
        '<a href="tel:+79613022112">+7 (961) 302-21-12</a> · ' +
        '<a href="https://t.me/Mariya061" target="_blank" rel="noopener">Telegram @Mariya061</a>';
    });
  }

  var formRadios = document.querySelectorAll('.form-radio input[type="radio"]');
  for (var i = 0; i < formRadios.length; i++) {
    formRadios[i].addEventListener('change', function() {
      var group = this.closest('.form-radio-group');
      if (group) {
        var allRadios = group.querySelectorAll('.form-radio');
        for (var j = 0; j < allRadios.length; j++) {
          allRadios[j].classList.remove('selected');
        }
        this.closest('.form-radio').classList.add('selected');
      }
    });
  }

  var allBtns = document.querySelectorAll('.btn');
  for (var i = 0; i < allBtns.length; i++) {
    allBtns[i].addEventListener('click', function(e) {
      var ripple = document.createElement('span');
      ripple.classList.add('ripple');
      var rect = this.getBoundingClientRect();
      var size = Math.max(rect.width, rect.height);
      ripple.style.width = size + 'px';
      ripple.style.height = size + 'px';
      ripple.style.left = (e.clientX - rect.left - size / 2) + 'px';
      ripple.style.top = (e.clientY - rect.top - size / 2) + 'px';
      this.appendChild(ripple);
      setTimeout(function() { ripple.remove(); }, 600);
    });
  }

  var heroEl = document.querySelector('.hero-bg');
  if (heroEl) {
    window.addEventListener('scroll', function() {
      heroEl.style.transform = 'translateY(' + (window.scrollY * 0.3) + 'px)';
    }, { passive: true });
  }

  var filterBtns = document.querySelectorAll('.cases-filter button');
  var caseCards = document.querySelectorAll('.case-card[data-category]');
  for (var i = 0; i < filterBtns.length; i++) {
    filterBtns[i].addEventListener('click', function() {
      var cat = this.getAttribute('data-filter');
      for (var j = 0; j < filterBtns.length; j++) {
        filterBtns[j].classList.remove('active');
      }
      this.classList.add('active');
      for (var k = 0; k < caseCards.length; k++) {
        if (cat === 'all' || caseCards[k].getAttribute('data-category') === cat) {
          caseCards[k].style.display = '';
        } else {
          caseCards[k].style.display = 'none';
        }
      }
    });
  }


  /* ============================================================
     СВЯЗКА КАЛЬКУЛЯТОРА С ЗАЯВКОЙ
     Кнопка «Зафиксировать этот расчёт» подставляет штат, тариф,
     зарплату и экономию в скрытые поля формы и плавно ведёт к ней.
     Раньше клиент считал выгоду и всё равно объяснял цифры заново.
     ============================================================ */
  var calcFix = document.querySelector('[data-calc-fix]');
  var homeForm = document.getElementById('home-lead-form');
  if (calcFix && homeForm) {
    calcFix.addEventListener('click', function () {
      var salarySlider = document.getElementById('salary-slider');
      var staffSlider = document.getElementById('staff-slider');
      var tierText = document.getElementById('staff-tier');
      var savingsText = document.getElementById('savings-month');

      function setField(name, value) {
        var field = homeForm.querySelector('[data-calc-field="' + name + '"]');
        if (field) field.value = value;
      }

      if (salarySlider) setField('salary', salarySlider.value);
      if (staffSlider) setField('staff', staffSlider.value);
      if (tierText) setField('tier', tierText.textContent.trim());
      if (savingsText) setField('savings', savingsText.textContent.trim());

      var comment = homeForm.querySelector('textarea[name="message"]');
      if (comment && staffSlider && tierText && savingsText) {
        var line = 'Расчёт с калькулятора: ' + staffSlider.value + ' чел., тариф ' + tierText.textContent.trim() +
          ', экономия ' + savingsText.textContent.trim() + ' ₽/мес.';
        if (comment.value.indexOf('Расчёт с калькулятора') === -1) {
          comment.value = (comment.value ? comment.value + '\n' : '') + line;
        }
      }

      var target = homeForm.closest('section') || homeForm;
      if (target && target.scrollIntoView) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      var nameInput = homeForm.querySelector('input[name="name"]');
      if (nameInput) {
        setTimeout(function () { nameInput.focus({ preventScroll: true }); }, 500);
      }
    });
  }

  /* ============================================================
     НИЖНЯЯ МОБИЛЬНАЯ ПЛАШКА
     Кнопка «Заявка» ведёт к ближайшей форме на странице; если формы
     нет — на страницу контактов. Плашку прячем, когда открыта форма,
     чтобы она не закрывала кнопку «Отправить».
     ============================================================ */
  var dockLead = document.querySelector('[data-dock-lead]');
  if (dockLead) {
    dockLead.addEventListener('click', function (e) {
      var form = document.querySelector('form[data-lead-form], form[data-validate]');
      if (form) {
        e.preventDefault();
        var box = form.closest('section') || form;
        box.scrollIntoView({ behavior: 'smooth', block: 'start' });
        var first = form.querySelector('input[name="name"]');
        if (first) setTimeout(function () { first.focus({ preventScroll: true }); }, 500);
      }
    });
  }

  var typeRadios = document.querySelectorAll('input[name="request_type"]');
  var staffGroup = document.getElementById('staff-count-group');
  for (var i = 0; i < typeRadios.length; i++) {
    typeRadios[i].addEventListener('change', function() {
      if (staffGroup) {
        if (this.value === 'subscription') {
          staffGroup.style.display = 'flex';
        } else {
          staffGroup.style.display = 'none';
        }
      }
    });
  }
});
