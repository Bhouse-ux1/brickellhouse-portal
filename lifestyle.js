(() => {
    "use strict";

    const video = document.getElementById("lifestyleVideo");
    if (!video) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let sufficientlyVisible = false;

    video.muted = true;
    video.defaultMuted = true;

    const updatePlayback = () => {
        const mayPlay = sufficientlyVisible
            && document.visibilityState !== "hidden"
            && !reducedMotion.matches;

        if (!mayPlay) {
            video.pause();
            return;
        }

        const playRequest = video.play();
        if (playRequest && typeof playRequest.catch === "function") {
            playRequest.catch(() => {
                // The poster remains visible if the browser declines autoplay.
            });
        }
    };

    const bindMediaChange = (mediaQuery) => {
        if (typeof mediaQuery.addEventListener === "function") {
            mediaQuery.addEventListener("change", updatePlayback);
        } else if (typeof mediaQuery.addListener === "function") {
            mediaQuery.addListener(updatePlayback);
        }
    };

    bindMediaChange(reducedMotion);
    document.addEventListener("visibilitychange", updatePlayback);
    window.addEventListener("pagehide", () => video.pause());

    if ("IntersectionObserver" in window) {
        const observer = new IntersectionObserver((entries) => {
            const entry = entries[0];
            sufficientlyVisible = Boolean(
                entry
                && entry.isIntersecting
                && entry.intersectionRatio >= 0.45
            );
            updatePlayback();
        }, {
            threshold: [0, 0.45, 1]
        });

        observer.observe(video);
    } else {
        sufficientlyVisible = true;
        updatePlayback();
    }
})();
