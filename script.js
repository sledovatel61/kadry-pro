## script.js

```javascript
/* ============================================
   КАДРОВЫЙ АУТСОРСИНГ — Мария Перепечай
   Global JavaScript
   ============================================ */

document.addEventListener('DOMContentLoaded', () => {

  // === PRELOADER ===
  const preloader = document.querySelector('.preloader');
  if (preloader) {
    window.addEventListener('load', () => {
      setTimeout(() => preloader.classList.add('hidden'), 300);
    });
    // Fallback
    setTimeout(() => preloader.classList.add('hidden'), 3000);
  }

  // === NAVIGATION SCROLL ===
  const nav = document.querySelector('.nav');
  if (nav) {
    const onScroll = () => {
      nav.classList.toggle('scrolled', window.scrollY > 50);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  // === MOBILE MENU ===
  const hamburger = document.querySelector('.hamburger');
  const mobileMenu = document.querySelector('.mobile-menu');
  if (hamburger && mobileMenu) {
    hamburger.addEventListener('click', () => {
      hamburger.classList.toggle('active');
      mobileMenu.classList.toggle('active');
      document.body.style.overflow = mobileMenu.classList.contains('active') ? 'hidden' : '';
    });
    mobileMenu.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        hamburger.classList.remove('active');
        mobileMenu.classList.remove('active');
        document.body.style.overflow = '';
      });
    });
  }

  // === SMOOTH SCROLL ===
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function(e) {
      const target = document.querySelector(this.getAttribute('href'));
      if (target) {
        e.preventDefault();
        const offset = 80;
        const y = target.getBoundingClientRect().top + window.pageYOffset - offset;
        window.scrollTo({ top: y, behavior: 'smooth' });
      }
    });
  });

  // === SCROLL ANIMATIONS (IntersectionObserver) ===
  const animElements = document.querySelectorAll('.anim');
  if (animElements.length > 0) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });
    animElements.forEach(el => observer.observe(el));
  }

  // === COUNTER ANIMATION ===
  const counters = document.querySelectorAll('[data-count]');
  if (counters.length > 0) {
    const counterObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          animateCounter(entry.target);
          counterObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.5 });
    counters.forEach(el => counterObserver.observe(el));
  }

  function animateCounter(el) {
    const target = parseInt(el.getAttribute('data-count'));
    const suffix = el.getAttribute('data-suffix') || '';
    const prefix = el.getAttribute('data-prefix') || '';
    const duration = 2000;
    const start = performance.now();

    function update(now) {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // easeOutCubic
      const current = Math.floor(eased * target);
      el.textContent = prefix + current.toLocaleString('ru-RU') + suffix;
      if (progress < 1) requestAnimationFrame(update);
    }
    requestAnimationFrame(update);
  }

  // === CALCULATOR ===
  const salarySlider = document.getElementById('salary-slider');
  const staffSlider = document.getElementById('staff-slider');

  if (salarySlider && staffSlider) {
    const salaryValue = document.getElementById('salary-value');
    const salaryTax = document.getElementById('salary-tax');
    const salaryTotal = document.getElementById('salary-total');
    const salaryWorkplace = document.getElementById('salary-workplace');

    const staffValue = document.getElementById('staff-value');
    const staffTier = document.getElementById('staff-tier');
    const staffPrice = document.getElementById('staff-price');

    const savingsMonth = document.getElementById('savings-month');
    const savingsYear = document.getElementById('savings-year');

    function getTierPrice(count) {
      if (count <= 10) return 12000;
      if (count <= 30) return 18000;
      return 25000;
    }

    function getTierName(count) {
      if (count <= 10) return '«Старт» (до 10 чел.)';
      if (count <= 30) return '«Бизнес» (11–30 чел.)';
      return '«Максимум» (31–50 чел.)';
    }

    function updateCalculator() {
      const salary = parseInt(salarySlider.value);
      const staff = parseInt(staffSlider.value);
      const taxRate = 0.302;
      const workplaceCost = 5000;
      const tax = Math.round(salary * taxRate);
      const totalEmployer = salary + tax + workplaceCost;
      const tierPrice = getTierPrice(staff);
      const savings = totalEmployer - tierPrice;

      salaryValue.textContent = salary.toLocaleString('ru-RU');
      if (salaryTax) salaryTax.textContent = tax.toLocaleString('ru-RU') + ' ₽';
      if (salaryTotal) salaryTotal.textContent = totalEmployer.toLocaleString('ru-RU') + ' ₽';
      if (salaryWorkplace) salaryWorkplace.textContent = workplaceCost.toLocaleString('ru-RU') + ' ₽';

      staffValue.textContent = staff;
      if (staffTier) staffTier.textContent = getTierName(staff);
      if (staffPrice) staffPrice.textContent = tierPrice.toLocaleString('ru-RU') + ' ₽/мес';

      if (savingsMonth) savingsMonth.textContent = Math.max(0, savings).toLocaleString('ru-RU');
      if (savingsYear) savingsYear.textContent = Math.max(0, savings * 12).toLocaleString('ru-RU') + ' ₽ в год';

      // Update range fill
      updateRangeFill(salarySlider);
      updateRangeFill(staffSlider);
    }

    function updateRangeFill(slider) {
      const min = parseFloat(slider.min);
      const max = parseFloat(slider.max);
      const val = parseFloat(slider.value);
      const pct = ((val - min) / (max - min)) * 100;
      slider.style.background = `linear-gradient(to right, var(--accent) 0%, var(--accent) ${pct}%, var(--border-color) ${pct}%, var(--border-color) 100%)`;
    }

    salarySlider.addEventListener('input', updateCalculator);
    staffSlider.addEventListener('input', updateCalculator);
    updateCalculator();
  }

  // === TABS ===
  document.querySelectorAll('.tabs-nav').forEach(nav => {
    const buttons = nav.querySelectorAll('button');
    const parent = nav.closest('.tabs-container') || nav.parentElement;
    const contents = parent.querySelectorAll('.tab-content');

    buttons.forEach(btn => {
      btn.addEventListener('click', () => {
        const target = btn.getAttribute('data-tab');
        buttons.forEach(b => b.classList.remove('active'));
        contents.forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        const targetContent = parent.querySelector(`#${target}`);
        if (targetContent) targetContent.classList.add('active');
      });
    });
  });

  // URL tab support
  const urlParams = new URLSearchParams(window.location.search);
  const tabParam = urlParams.get('tab');
  if (tabParam) {
    const tabBtn = document.querySelector(`.tabs-nav button[data-tab="${tabParam}"]`);
    if (tabBtn) tabBtn.click();
  }

  // === ACCORDION ===
  document.querySelectorAll('.accordion-header').forEach(header => {
    header.addEventListener('click', () => {
      const item = header.parentElement;
      const isActive = item.classList.contains('active');
      // Close all siblings
      item.parentElement.querySelectorAll('.accordion-item').forEach(i => i.classList.remove('active'));
      if (!isActive) item.classList.add('active');
    });
  });

  // === PHONE MASK ===
  document.querySelectorAll('input[data-mask="phone"]').forEach(input => {
    input.addEventListener('input', function(e) {
      let val = this.value.replace(/\D/g, '');
      if (val.startsWith('8')) val = '7' + val.slice(1);
      if (!val.startsWith('7') && val.length > 0) val = '7' + val;
      let formatted = '';
      if (val.length > 0) formatted = '+7';
      if (val.length > 1) formatted += ' (' + val.slice(1, 4);
      if (val.length > 4) formatted += ') ' + val.slice(4, 7);
      if (val.length > 7) formatted += '-' + val.slice(7, 9);
      if (val.length > 9) formatted += '-' + val.slice(9, 11);
      this.value = formatted;
    });
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Backspace' && this.value.length <= 3) {
        e.preventDefault();
        this.value = '';
      }
    });
    input.addEventListener('focus', function() {
      if (!this.value) this.value = '+7';
    });
    input.addEventListener('blur', function() {
      if (this.value === '+7') this.value = '';
    });
  });

  // === FORM VALIDATION & SUBMISSION ===
  document.querySelectorAll('form[data-validate]').forEach(form => {
    form.addEventListener('submit', function(e) {
      e.preventDefault();
      let valid = true;

      // Reset errors
      form.querySelectorAll('.form-input, .form-textarea, .form-select').forEach(inp => {
        inp.classList.remove('error');
      });

      // Validate required
      form.querySelectorAll('[required]').forEach(field => {
        if (!field.value.trim()) {
          field.classList.add('error');
          valid = false;
        }
      });

      // Validate email
      const emailField = form.querySelector('input[type="email"]');
      if (emailField && emailField.value) {
        const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRe.test(emailField.value)) {
          emailField.classList.add('error');
          valid = false;
        }
      }

      // Validate phone
      const phoneField = form.querySelector('input[data-mask="phone"]');
      if (phoneField && phoneField.value) {
        const digits = phoneField.value.replace(/\D/g, '');
        if (digits.length < 11) {
          phoneField.classList.add('error');
          valid = false;
        }
      }

      // Validate checkbox
      const consent = form.querySelector('input[name="consent"]');
      if (consent && !consent.checked) {
        valid = false;
        consent.closest('.form-checkbox')?.classList.add('error');
      }

      if (!valid) {
        const firstError = form.querySelector('.error');
        if (firstError) firstError.focus();
        return;
      }

      // Collect form data
      const formData = new FormData(form);
      const data = {};
      formData.forEach((val, key) => { data[key] = val; });

      // Show success (in production, send via fetch to API)
      const successEl = form.querySelector('.form-success') || form.parentElement.querySelector('.form-success');
      if (successEl) {
        form.style.display = 'none';
        successEl.classList.add('visible');
      }

      // Placeholder: send to Telegram / Formspree
      console.log('Form submitted:', data);

      /*
      // Example: Formspree
      fetch('https://formspree.io/f/YOUR_ID', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });

      // Example: Telegram Bot
      const tgToken = 'YOUR_BOT_TOKEN';
      const tgChat = 'YOUR_CHAT_ID';
      const text = Object.entries(data).map(([k,v]) => `${k}: ${v}`).join('\n');
      fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: tgChat, text: `Новая заявка:\n${text}` })
      });
      */
    });
  });

  // === RADIO BUTTONS VISUAL ===
  document.querySelectorAll('.form-radio input[type="radio"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const group = radio.closest('.form-radio-group');
      if (group) {
        group.querySelectorAll('.form-radio').forEach(r => r.classList.remove('selected'));
        radio.closest('.form-radio').classList.add('selected');
      }
    });
  });

  // === BUTTON RIPPLE ===
  document.querySelectorAll('.btn').forEach(btn => {
    btn.addEventListener('click', function(e) {
      const ripple = document.createElement('span');
      ripple.classList.add('ripple');
      const rect = this.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height);
      ripple.style.width = ripple.style.height = size + 'px';
      ripple.style.left = (e.clientX - rect.left - size / 2) + 'px';
      ripple.style.top = (e.clientY - rect.top - size / 2) + 'px';
      this.appendChild(ripple);
      setTimeout(() => ripple.remove(), 600);
    });
  });

  // === PARALLAX (subtle) ===
  const heroEl = document.querySelector('.hero-bg');
  if (heroEl) {
    window.addEventListener('scroll', () => {
      const y = window.scrollY;
      heroEl.style.transform = `translateY(${y * 0.3}px)`;
    }, { passive: true });
  }

  // === COOKIE BANNER ===
  const cookieBanner = document.querySelector('.cookie-banner');
  const cookieAccept = document.getElementById('cookie-accept');
  if (cookieBanner && !localStorage.getItem('cookies-accepted')) {
    setTimeout(() => cookieBanner.classList.add('visible'), 2000);
  }
  if (cookieAccept) {
    cookieAccept.addEventListener('click', () => {
      localStorage.setItem('cookies-accepted', 'true');
      cookieBanner.classList.remove('visible');
    });
  }

  // === CASES FILTER ===
  const filterBtns = document.querySelectorAll('.cases-filter button');
  const caseCards = document.querySelectorAll('.case-card[data-category]');
  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const cat = btn.getAttribute('data-filter');
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      caseCards.forEach(card => {
        if (cat === 'all' || card.getAttribute('data-category') === cat) {
          card.style.display = '';
          setTimeout(() => card.style.opacity = '1', 10);
        } else {
          card.style.opacity = '0';
          setTimeout(() => card.style.display = 'none', 300);
        }
      });
    });
  });

  // === DYNAMIC FORM FIELDS (contact page) ===
  const typeRadios = document.querySelectorAll('input[name="request_type"]');
  const staffGroup = document.getElementById('staff-count-group');
  typeRadios.forEach(radio => {
    radio.addEventListener('change', () => {
      if (staffGroup) {
        staffGroup.style.display = radio.value === 'subscription' ? 'flex' : 'none';
      }
    });
  });

}); // End DOMContentLoaded
```

---