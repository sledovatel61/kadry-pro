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
  
  // Gradient glows
  html += '<div class="bg-decor-glow bg-decor-glow--1"></div>';
  html += '<div class="bg-decor-glow bg-decor-glow--2"></div>';
  html += '<div class="bg-decor-glow bg-decor-glow--3"></div>';
  
  // Texture
  html += '<div class="bg-decor-texture"></div>';
  
  // Rings
  html += '<div class="bg-decor-ring bg-decor-ring--1"></div>';
  html += '<div class="bg-decor-ring bg-decor-ring--2"></div>';
  html += '<div class="bg-decor-ring bg-decor-ring--3"></div>';
  
  // Lines
  html += '<div class="bg-decor-line bg-decor-line--l"></div>';
  html += '<div class="bg-decor-line bg-decor-line--r"></div>';
  html += '<div class="bg-decor-hline bg-decor-hline--1"></div>';
  html += '<div class="bg-decor-hline bg-decor-hline--2"></div>';
  
  // Dots
  html += '<div class="bg-decor-dot bg-decor-dot--1"></div>';
  html += '<div class="bg-decor-dot bg-decor-dot--2"></div>';
  html += '<div class="bg-decor-dot bg-decor-dot--3"></div>';
  html += '<div class="bg-decor-dot bg-decor-dot--4"></div>';
  html += '<div class="bg-decor-dot bg-decor-dot--5"></div>';
  
  // Corners
  html += '<div class="bg-decor-corner bg-decor-corner--tl"></div>';
  html += '<div class="bg-decor-corner bg-decor-corner--br"></div>';
  html += '<div class="bg-decor-corner bg-decor-corner--tr"></div>';
  html += '<div class="bg-decor-corner bg-decor-corner--bl"></div>';
  
  // Matrix numbers
  html += '<div class="bg-decor-matrix">01 48 27 93 56 10 83 42 07 69 31 58 24 75 90 16 63 38 52 84 09 47 71 25 96 03 68 14 82 55 39 70 28 61 43 97 05 36 80 19 57 22 74 46 88 13 65 02 91 34 78 50 17 62 29 85 44 08 73 51 26 99 37 64 11 48 82 20 59 76 33 95 06 41 87 23 18 54 79 32 60 15 93 47 72 01 38 86 24 53 69 10 45 81 27 94 56 03 67 30 88</div>';
  
  // SVG Icon 1: Document
  html += '<svg class="bg-decor-icon bg-decor-icon--1" viewBox="0 0 40 52" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round">';
  html += '<path d="M6 2h20l8 8v40H6z"/><path d="M26 2v8h8"/>';
  html += '<line x1="12" y1="18" x2="28" y2="18"/><line x1="12" y1="24" x2="28" y2="24"/>';
  html += '<line x1="12" y1="30" x2="22" y2="30"/><line x1="12" y1="36" x2="26" y2="36"/>';
  html += '</svg>';
  
  // SVG Icon 2: Person silhouette
  html += '<svg class="bg-decor-icon bg-decor-icon--2" viewBox="0 0 40 52" fill="none" stroke="currentColor" stroke-width="1">';
  html += '<circle cx="20" cy="12" r="8"/><path d="M4 48c0-8.8 7.2-16 16-16s16 7.2 16 16"/>';
  html += '</svg>';
  
  // SVG Icon 3: Bar chart
  html += '<svg class="bg-decor-icon bg-decor-icon--3" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round">';
  html += '<rect x="4" y="30" width="8" height="14" rx="1"/><rect x="16" y="20" width="8" height="24" rx="1"/>';
  html += '<rect x="28" y="10" width="8" height="34" rx="1"/><rect x="40" y="22" width="4" height="22" rx="1"/>';
  html += '<line x1="2" y1="46" x2="46" y2="46"/><polyline points="4,28 16,18 28,8 44,20" stroke-dasharray="3 3"/>';
  html += '</svg>';
  
  // SVG Icon 4: Checklist
  html += '<svg class="bg-decor-icon bg-decor-icon--4" viewBox="0 0 44 56" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round">';
  html += '<rect x="2" y="2" width="40" height="52" rx="4"/>';
  html += '<polyline points="10,16 14,20 22,12"/><line x1="26" y1="16" x2="36" y2="16"/>';
  html += '<polyline points="10,28 14,32 22,24"/><line x1="26" y1="28" x2="36" y2="28"/>';
  html += '<polyline points="10,40 14,44 22,36"/><line x1="26" y1="40" x2="36" y2="40"/>';
  html += '</svg>';
  
  // SVG Icon 5: Stamp
  html += '<svg class="bg-decor-icon bg-decor-icon--5" viewBox="0 0 44 44" fill="none" stroke="currentColor" stroke-width="1">';
  html += '<circle cx="22" cy="22" r="19"/><circle cx="22" cy="22" r="14"/><circle cx="22" cy="22" r="5"/>';
  html += '<line x1="22" y1="3" x2="22" y2="8"/><line x1="22" y1="36" x2="22" y2="41"/>';
  html += '<line x1="3" y1="22" x2="8" y2="22"/><line x1="36" y1="22" x2="41" y2="22"/>';
  html += '</svg>';
  
  // SVG Icon 6: Shield
  html += '<svg class="bg-decor-icon bg-decor-icon--6" viewBox="0 0 40 50" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round">';
  html += '<path d="M20 2L2 12v14c0 12 8 18 18 22 10-4 18-10 18-22V12z"/>';
  html += '<polyline points="12,26 18,32 28,20"/>';
  html += '</svg>';
  
  // Arrow 1
  html += '<svg class="bg-decor-arrow bg-decor-arrow--1" viewBox="0 0 24 60" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">';
  html += '<line x1="12" y1="2" x2="12" y2="50"/><polyline points="6,44 12,52 18,44"/>';
  html += '<circle cx="12" cy="2" r="3" fill="currentColor" opacity="0.3"/>';
  html += '</svg>';
  
  // Arrow 2
  html += '<svg class="bg-decor-arrow bg-decor-arrow--2" viewBox="0 0 24 60" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">';
  html += '<line x1="12" y1="2" x2="12" y2="50"/><polyline points="6,44 12,52 18,44"/>';
  html += '<circle cx="12" cy="2" r="3" fill="currentColor" opacity="0.3"/>';
  html += '</svg>';
  
  container.innerHTML = html;
}

document.addEventListener('DOMContentLoaded', function () {
  initBgDecor();

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
      slider.style.background = 'linear-gradient(to right, var(--accent) 0%, var(--accent) ' + pct + '%, var(--border-color) ' + pct + '%, var(--border-color) 100%)';
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

  var leadForms = document.querySelectorAll('form[data-lead-form], form[data-validate]');
  for (var lf = 0; lf < leadForms.length; lf++) {
    leadForms[lf].addEventListener('submit', function (e) {
      /* Если заявки уже отправляет leads-form.ts — не мешаем ему. */
      if (this.dataset.leadsBound === '1') return;
      e.preventDefault();
      var form = this;
      var valid = true;

      var inputs = form.querySelectorAll('.form-input, .form-textarea, .form-select');
      for (var i = 0; i < inputs.length; i++) inputs[i].classList.remove('error');

      var required = form.querySelectorAll('[required]');
      for (var j = 0; j < required.length; j++) {
        var field = required[j];
        var empty = field.type === 'checkbox' ? !field.checked : !String(field.value || '').trim();
        if (empty) {
          field.classList.add('error');
          valid = false;
        }
      }

      var phoneField = form.querySelector('input[data-mask="phone"]');
      if (phoneField && phoneField.value) {
        var digits = phoneField.value.replace(/\D/g, '');
        var isNick = /^@/.test(phoneField.value.trim());
        if (!isNick && digits.length < 11) {
          phoneField.classList.add('error');
          valid = false;
        }
      }

      if (!valid) {
        var firstError = form.querySelector('.error');
        if (firstError) firstError.focus();
        return;
      }

      var status = form.querySelector('.quick-lead-status');
      if (!status) {
        /* На «Контактах» и в статье форма своя, без блока .quick-lead-status.
           Создаём его на месте — иначе человек нажимает кнопку и ничего не видит. */
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
      status.innerHTML = 'Заявка почти ушла — остался один шаг. Напишите или позвоните напрямую: ' +
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
