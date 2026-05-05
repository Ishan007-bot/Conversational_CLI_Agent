(function () {
  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  ready(function () {
    var header = document.querySelector('.site-header');
    var hamburger = document.querySelector('.hamburger');

    // 1) Header scroll-shadow
    if (header) {
      var setScrolled = function () {
        if (window.scrollY > 40) header.classList.add('scrolled');
        else header.classList.remove('scrolled');
      };
      setScrolled();
      window.addEventListener('scroll', setScrolled, { passive: true });
    }

    // 2) Mobile hamburger toggle
    if (hamburger && header) {
      hamburger.addEventListener('click', function () {
        var open = header.classList.toggle('open');
        hamburger.setAttribute('aria-expanded', String(open));
      });
    }

    // 3) Smooth-scroll for in-page anchor clicks
    document.addEventListener('click', function (e) {
      var link = e.target.closest('a[href^="#"]');
      if (!link) return;
      var id = link.getAttribute('href');
      if (!id || id === '#') return;
      var target = document.querySelector(id);
      if (!target) return;
      e.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      if (header && header.classList.contains('open')) {
        header.classList.remove('open');
        if (hamburger) hamburger.setAttribute('aria-expanded', 'false');
      }
    });
  });
})();
