document.addEventListener('DOMContentLoaded', function() {

  var preloader = document.querySelector('.preloader');
  if (preloader) {
    window.addEventListener('load', function() {
      setTimeout(function() { preloader.classList.add('hidden'); }, 300);
    });
    setTimeout(function() { preloader.classList.add('hidden'); }, 3000);
  }

  var nav = document.querySelector('.nav');
  if (nav) {
    window.addEventListener('scroll', function() {
      if (window.scrollY > 50) {
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
    var salaryTax = document.getElementById('salary-tax');
    var salaryTotal = document.getElementById('salary-total');
    var salaryWorkplace = document.getElementById('salary-workplace');
    var staffValue = document.getElementById('staff-value');
    var staffTier = document.getElementById('staff-tier');
    var staffPrice = document.getElementById('staff-price');
    var savingsMonth = document.getElementById('savings-month');
    var savingsYear = document.getElementById('savings-year');

    function getTierPrice(count) {
      if (count <= 10) return 12000;
      if (count <= 30) return 18000;
      return 25000;
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
      slider.style.background = 'linear-gradient(to right, #4ade80 0%, #4ade80 ' + pct + '%, #333333 ' + pct + '%, #333333 100%)';
    }

    function updateCalculator() {
      var salary = parseInt(salarySlider.value);
      var staff = parseInt(staffSlider.value);
      var taxRate = 0.302;
      var workplaceCost = 5000;
      var tax = Math.round(salary * taxRate);
      var totalEmployer = salary + tax + workplaceCost;
      var tierPrice = getTierPrice(staff);
      var savings = totalEmployer - tierPrice;

      if (salaryValue) salaryValue.textContent = formatNumber(salary);
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

  var accHeaders = document.querySelectorAll('.accordion-header');
  for (var i = 0; i < accHeaders.length; i++) {
    accHeaders[i].addEventListener('click', function() {
      var item = this.parentElement;
      var isActive = item.classList.contains('active');
      var siblings = item.parentElement.querySelectorAll('.accordion-item');
      for (var j = 0; j < siblings.length; j++) {
        siblings[j].classList.remove('active');
      }
      if (!isActive) item.classList.add('active');
    });
  }

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

  // --- НАСТРОЙКА ОТПРАВКИ ФОРМЫ ---
  var forms = document.querySelectorAll('form[data-validate]');
  for (var f = 0; f < forms.length; f++) {
    forms[f].addEventListener('submit', function(e) {
      e.preventDefault();
      var form = this;
      var valid = true;

      // --- ВСЕ ПРОВЕРКИ ВАЛИДНОСТИ ОСТАЮТСЯ БЕЗ ИЗМЕНЕНИЙ ---
      var inputs = form.querySelectorAll('.form-input, .form-textarea, .form-select');
      for (var i = 0; i < inputs.length; i++) {
        inputs[i].classList.remove('error');
      }
      var required = form.querySelectorAll('[required]');
      for (var i = 0; i < required.length; i++) {
        if (!required[i].value.trim()) {
          required[i].classList.add('error');
          valid = false;
        }
      }
      var emailField = form.querySelector('input[type="email"]');
      if (emailField && emailField.value) {
        var emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRe.test(emailField.value)) {
          emailField.classList.add('error');
          valid = false;
        }
      }
      var phoneField = form.querySelector('input[data-mask="phone"]');
      if (phoneField && phoneField.value) {
        var digits = phoneField.value.replace(/\D/g, '');
        if (digits.length < 11) {
          phoneField.classList.add('error');
          valid = false;
        }
      }
      var consent = form.querySelector('input[name="consent"]');
      if (consent && !consent.checked) {
        valid = false;
      }
      // --- КОНЕЦ ПРОВЕРОК ВАЛИДНОСТИ ---

      // Если форма не прошла проверку
      if (!valid) {
        var firstError = form.querySelector('.error');
        if (firstError) firstError.focus();
        return;
      }

      // --- НОВЫЙ КОД: ОТПРАВКА ДАННЫХ НА СЕРВЕР ---
      // Показываем пользователю, что идёт отправка (можно изменить текст кнопки, но для простоты пока оставим так)
      var submitButton = form.querySelector('button[type="submit"]');
      var originalButtonText = submitButton ? submitButton.textContent : 'Отправить заявку';
      if (submitButton) {
        submitButton.textContent = 'Отправка...';
        submitButton.disabled = true;
      }

      // Собираем данные из формы
      var formData = new FormData(form);
      // Важно! Formspree ожидает данные в формате FormData, что нам и подходит.

      // Отправляем запрос на наш эндпоинт от Formspree
      fetch('https://formspree.io/f/xojpqrav', { // ВСТАВЬТЕ СВОЙ АДРЕС
        method: 'POST',
        body: formData,
        headers: {
          'Accept': 'application/json' // Говорим, что ждём ответ в JSON
        }
      })
      .then(response => {
        if (response.ok) {
          return response.json(); // Если всё хорошо, разбираем ответ
        }
        throw new Error('Ошибка сети или сервера');
      })
      .then(data => {
        // Успешная отправка
        var successEl = form.querySelector('.form-success');
        if (!successEl) successEl = form.parentElement.querySelector('.form-success');
        if (successEl) {
          form.style.display = 'none';
          successEl.classList.add('visible');
        } else {
          // Если нет блока с успехом, просто очищаем форму и показываем alert
          alert('Заявка успешно отправлена!');
          form.reset();
        }
      })
      .catch(error => {
        // Ошибка отправки
        console.error('Ошибка:', error);
        alert('Произошла ошибка при отправке. Пожалуйста, попробуйте позже или свяжитесь по телефону.');
        // Возвращаем кнопку в исходное состояние
        if (submitButton) {
          submitButton.textContent = originalButtonText;
          submitButton.disabled = false;
        }
      })
      .finally(() => {
        // В любом случае, если отправка прошла успешно, кнопка уже не нужна,
        // но если была ошибка, мы её уже разблокировали выше.
        // Этот блок выполнится после всего.
      });
      // --- КОНЕЦ НОВОГО КОДА ---

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

  var cookieBanner = document.querySelector('.cookie-banner');
  var cookieAccept = document.getElementById('cookie-accept');
  if (cookieBanner && !localStorage.getItem('cookies-accepted')) {
    setTimeout(function() { cookieBanner.classList.add('visible'); }, 2000);
  }
  if (cookieAccept) {
    cookieAccept.addEventListener('click', function() {
      localStorage.setItem('cookies-accepted', 'true');
      cookieBanner.classList.remove('visible');
    });
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
