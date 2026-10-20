(function () {
    'use strict';

    /* ========================================================
       ТАЙМЕР ЗАГРУЗКИ (5 СЕКУНД)
       ======================================================== */
    const preloader   = document.getElementById('preloader');
    const countNum    = document.getElementById('countNum');
    const countBig    = document.getElementById('countBig');

    let secondsLeft = 5;
    if (countNum) countNum.textContent = secondsLeft;
    if (countBig) countBig.textContent = secondsLeft;

    const countInterval = setInterval(() => {
        secondsLeft--;
        if (secondsLeft < 0) secondsLeft = 0;

        if (countNum) countNum.textContent = secondsLeft;
        if (countBig) countBig.textContent = secondsLeft;

        if (secondsLeft <= 0) {
            clearInterval(countInterval);
            if (preloader) {
                preloader.classList.add('hidden');
                setTimeout(() => { preloader.style.display = 'none'; }, 600);
            }
        }
    }, 1000);

    /* ========================================================
       ОСНОВНАЯ ЛОГИКА
       ======================================================== */
    const body        = document.body;
    const gasBtn      = document.getElementById('gasBtn');
    const rpmWrap     = document.getElementById('rpmWrap');
    const rpmFill     = document.getElementById('rpmFill');
    const rpmVal      = document.getElementById('rpmVal');
    const scrollHint  = document.getElementById('scrollHint');
    const lockToast   = document.getElementById('lockToast');
    const wheel       = document.getElementById('wheel');
    const deliveryMsg = document.getElementById('deliveryMsg');
    const audioEl     = document.getElementById('engineSound');

    const TARGET = 90;
    const HOLD_TICK_MS = 30;
    const RISE_PER_TICK = 1.6;
    const FALL_PER_TICK = 2.4;

    let rpm = 0, holding = false, done = false, tickTimer = null;
    if (body) body.classList.add('locked');

    /* ========================================================
       🔊 АУДИО — ИСПРАВЛЕНО ДЛЯ МОБИЛЬНЫХ
       ======================================================== */
    let audioCtx = null;
    let sourceNode = null;
    let gainNode = null;
    let audioUnlocked = false;

    // Расчёт громкости: 60% → 100%
    function computeVolume() {
        const minV = 0.6;
        const maxV = 1.0;
        const t = Math.min(1, rpm / 100);
        return minV + (maxV - minV) * t;
    }

    // Инициализация Web Audio API (без await!)
    function initAudioContext() {
        if (audioCtx) return;
        try {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return;
            audioCtx = new AC();
            sourceNode = audioCtx.createMediaElementSource(audioEl);
            gainNode = audioCtx.createGain();
            gainNode.gain.value = 1.0;
            sourceNode.connect(gainNode);
            gainNode.connect(audioCtx.destination);
        } catch (e) {
            console.warn('Web Audio API не поддерживается:', e);
        }
    }

    // РАЗБЛОКИРОВКА: вызывается синхронно при первом касании
    // Проигрываем беззвучный буфер, чтобы «разбудить» контекст навсегда
    function unlockAudio() {
        if (audioUnlocked || !audioEl) return;

        if (!audioCtx) initAudioContext();

        if (audioCtx && audioCtx.state === 'suspended') {
            // resume() вызываем БЕЗ await — это важно для iOS
            audioCtx.resume().catch(() => {});
        }

        // Проигрываем короткий беззвучный буфер для полной разблокировки
        if (audioCtx) {
            try {
                const buffer = audioCtx.createBuffer(1, 1, 22050);
                const src = audioCtx.createBufferSource();
                src.buffer = buffer;
                src.connect(audioCtx.destination);
                src.start(0);
            } catch (e) {}
        }

        audioUnlocked = true;
    }

    // ЗАПУСК ЗВУКА: play() вызывается СИНХРОННО, до любых await
    function startEngineSound() {
        if (!audioEl) return;

        // 1. Будим контекст (без await)
        if (audioCtx && audioCtx.state === 'suspended') {
            audioCtx.resume().catch(() => {});
        }

        try {
            // 2. Сбрасываем и сразу вызываем play() — это КЛЮЧЕВОЙ ФИКС
            audioEl.pause();
            audioEl.currentTime = 0;
            audioEl.volume = computeVolume();

            // 3. play() СИНХРОННО, без .then() перед ним
            const playPromise = audioEl.play();

            // 4. Обработка ошибки — если браузер всё равно заблокировал
            if (playPromise !== undefined) {
                playPromise.catch((err) => {
                    console.warn('Аудио заблокировано:', err);
                    // Пробуем ещё раз через 80 мс (запасной вариант)
                    setTimeout(() => {
                        if (!done && holding) {
                            audioEl.play().catch(() => {});
                        }
                    }, 80);
                });
            }
        } catch (e) {
            console.warn('Ошибка запуска:', e);
        }
    }

    function stopEngineSound() {
        if (!audioEl) return;
        try {
            audioEl.pause();
            audioEl.currentTime = 0;
        } catch (e) {}
    }

    function updateVolume() {
        if (!audioEl || audioEl.paused) return;
        try {
            audioEl.volume = computeVolume();
        } catch (e) {}
    }

    /* ========================================================
       ЛОГИКА RPM
       ======================================================== */
    function renderRpm() {
        const v = Math.max(0, Math.min(100, rpm));
        if (rpmFill) rpmFill.style.width = v + '%';
        if (rpmVal) rpmVal.textContent = Math.round(v);
        updateVolume();
        if (v >= TARGET && !done) markDone();
    }

    function stepRpm() {
        rpm += holding ? RISE_PER_TICK : -FALL_PER_TICK;
        if (rpm < 0) rpm = 0;
        if (rpm > 100) rpm = 100;
        renderRpm();

        if (holding || rpm > 0) {
            tickTimer = setTimeout(stepRpm, HOLD_TICK_MS);
        } else {
            clearTimeout(tickTimer);
            tickTimer = null;
        }
    }

    function startTick() { if (!tickTimer) stepRpm(); }

    function onPressStart(e) {
        if (done) return;
        e.preventDefault();
        holding = true;
        if (gasBtn) gasBtn.classList.add('active');
        if (rpmWrap) rpmWrap.classList.add('show');

        // СИНХРОННЫЙ ВЫЗОВ: unlockAudio → startEngineSound
        // Никаких await, никаких .then() между ними
        unlockAudio();
        startEngineSound();
        startTick();
    }

    function onPressEnd() {
        if (done) return;
        holding = false;
        if (gasBtn) gasBtn.classList.remove('active');
        stopEngineSound();
    }

    // ВАЖНО: passive: false для touchstart, чтобы preventDefault работал
    if (gasBtn) {
        gasBtn.addEventListener('mousedown', onPressStart);
        gasBtn.addEventListener('touchstart', onPressStart, { passive: false });
    }
    window.addEventListener('mouseup', onPressEnd);
    window.addEventListener('touchend', onPressEnd);
    if (gasBtn) {
        gasBtn.addEventListener('mouseleave', onPressEnd);
        gasBtn.addEventListener('touchcancel', onPressEnd);
    }

    function markDone() {
        done = true;
        holding = false;
        rpm = TARGET;
        renderRpm();

        if (gasBtn) {
            gasBtn.classList.remove('active');
            gasBtn.classList.add('done');
            gasBtn.textContent = 'ПОЕХАЛИ!';
        }
        if (rpmWrap) rpmWrap.classList.add('passed');

        if (deliveryMsg) deliveryMsg.classList.add('show');
        if (body) body.classList.remove('locked');
        if (scrollHint) scrollHint.classList.add('show');

        // Плавное затухание
        setTimeout(() => {
            if (audioEl) {
                const fadeOut = setInterval(() => {
                    if (!audioEl || audioEl.paused) {
                        clearInterval(fadeOut);
                        return;
                    }
                    if (audioEl.volume > 0.05) {
                        audioEl.volume = Math.max(0, audioEl.volume - 0.08);
                    } else {
                        audioEl.volume = 0;
                        audioEl.pause();
                        audioEl.currentTime = 0;
                        audioEl.volume = computeVolume();
                        clearInterval(fadeOut);
                    }
                }, 40);
            }
        }, 1500);

        if (navigator.vibrate) navigator.vibrate([30, 40, 30]);
        if (scrollHint) setTimeout(() => scrollHint.classList.remove('show'), 4000);
    }

    /* ========================================================
       БЛОКИРОВКА СКРОЛЛА
       ======================================================== */
    function showToast() {
        if (!lockToast) return;
        lockToast.classList.add('show');
        clearTimeout(showToast._t);
        showToast._t = setTimeout(() => lockToast.classList.remove('show'), 1600);
    }

    window.addEventListener('wheel', (e) => {
        if (body && body.classList.contains('locked') && e.deltaY > 0) {
            e.preventDefault();
            showToast();
        }
    }, { passive: false });

    let touchStartY = 0;
    window.addEventListener('touchstart', (e) => {
        touchStartY = e.touches[0].clientY;
    }, { passive: true });

    window.addEventListener('touchmove', (e) => {
        if (!body || !body.classList.contains('locked')) return;
        const dy = touchStartY - e.touches[0].clientY;
        if (dy > 10) {
            e.preventDefault();
            showToast();
        }
    }, { passive: false });

    window.addEventListener('keydown', (e) => {
        if (body && body.classList.contains('locked') && (e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === ' ')) {
            if (e.target === gasBtn || (gasBtn && gasBtn.contains(e.target))) return;
            e.preventDefault();
            showToast();
        }
        if (e.code === 'Space' && !done && document.activeElement === gasBtn) {
            e.preventDefault();
            if (!holding) onPressStart(e);
        }
    });

    window.addEventListener('keyup', (e) => {
        if (e.code === 'Space' && !done && holding) onPressEnd();
    });

    /* ========================================================
       ВРАЩЕНИЕ КОЛЕСА
       ======================================================== */
    let currentRotation = 0;
    let targetRotation = 0;
    let rafId = null;

    function onScroll() {
        if (!wheel) return;
        const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
        const docHeight = document.documentElement.scrollHeight - window.innerHeight;
        const progress = docHeight > 0 ? scrollTop / docHeight : 0;
        targetRotation = progress * 1080;

        if (!rafId) animateWheel();
    }

    function animateWheel() {
        const diff = targetRotation - currentRotation;
        currentRotation += diff * 0.15;

        if (Math.abs(diff) < 0.1) {
            currentRotation = targetRotation;
            if (wheel) wheel.style.transform = `rotate(${currentRotation}deg)`;
            rafId = null;
            return;
        }

        if (wheel) wheel.style.transform = `rotate(${currentRotation}deg)`;
        rafId = requestAnimationFrame(animateWheel);
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
})();
