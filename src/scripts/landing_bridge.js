(function() {
    'use strict';

    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id) return;
    if (!document.documentElement.hasAttribute('data-kroom-landing')) return;

    const log = (...args) => console.debug('[K-ROOM Bridge]', ...args);
    log('Bridge active on landing page.');

    window.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'YTMS_PAGE_PING') {
            log('Received Ping from page, responding with Pong.');
            window.postMessage({ type: 'YTMS_BRIDGE_PONG' }, '*');
        }
    });

    chrome.runtime.onMessage.addListener((msg) => {
        try {
            if (msg.type === 'YTMS_FREQ_DATA_SYNC') {
                if (Math.random() < 0.01) log('Data received from background, forwarding to page.');
                window.postMessage({ 
                    type: 'YTMS_FREQ_DATA_SYNC', 
                    data: msg.data 
                }, '*');
            }
        } catch (e) {}
    });

    function register() {
        if (!chrome.runtime || !chrome.runtime.id) return;
        try {
            chrome.runtime.sendMessage({ type: 'YTMS_LANDING_READY' }, () => {
                if (chrome.runtime.lastError) {}
            });
        } catch (e) {}
    }

    register();
    setInterval(register, 5000);

    window.postMessage({ type: 'YTMS_BRIDGE_PONG' }, '*');

})();
