let latestFreqData = null;
const landingTabs = new Set();

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'YTMS_CHECK_VERSION') {
        fetch('https://raw.githubusercontent.com/adeondev/k-room-yt-music/refs/heads/master/version', { cache: 'no-store' })
            .then(res => {
                if (!res.ok) throw new Error('Network response was not ok');
                return res.text();
            })
            .then(text => sendResponse({ version: text.trim() }))
            .catch(err => sendResponse({ error: err.message }));
        return true;
    }

    if (msg.type === 'YTMS_LANDING_READY') {
        if (sender.tab) {
            landingTabs.add(sender.tab.id);
            sendResponse({ ok: true });
        }
        return false;
    }

    if (msg.type === 'YTMS_FREQ_DATA') {
        latestFreqData = msg.data;
        if (landingTabs.size > 0) {
            // Diagnostic log (throttled)
            if (Math.random() < 0.01) {
                console.log(`[K-ROOM Background] Relaying data to ${landingTabs.size} tabs.`);
            }
            landingTabs.forEach(tabId => {
                chrome.tabs.sendMessage(tabId, { 
                    type: 'YTMS_FREQ_DATA_SYNC', 
                    data: latestFreqData 
                }).catch(() => {
                    landingTabs.delete(tabId);
                });
            });
        }
        return false;
    }
});

chrome.tabs.onRemoved.addListener((tabId) => {
    landingTabs.delete(tabId);
});

// Periodic scan to find landing tabs that might have missed registration
setInterval(() => {
    chrome.tabs.query({}, (tabs) => {
        tabs.forEach(tab => {
            if (tab.title && tab.title.includes('K-ROOM') && tab.title.includes('Volume Control')) {
                landingTabs.add(tab.id);
            } else if (tab.url && (tab.url.includes('index.html') || tab.url.includes('k-room'))) {
                if (tab.url.startsWith('file://') || tab.url.includes('github.io') || tab.url.includes('127.0.0.1')) {
                     landingTabs.add(tab.id);
                }
            }
        });
    });
}, 10000);

chrome.commands.onCommand.addListener((command) => {
    chrome.tabs.query({ url: '*://music.youtube.com/*' }, (tabs) => {
        if (!tabs || tabs.length === 0) return;
        if (command === 'play-pause' || command === 'next' || command === 'prev') {
            chrome.tabs.sendMessage(tabs[0].id, { type: 'YTMS_MEDIA_CONTROL', action: command });
        }
    });
});

chrome.commands.onCommand.addListener((command) => {
    chrome.tabs.query({ url: '*://music.youtube.com/*' }, (tabs) => {
        if (!tabs || tabs.length === 0) return;
        if (command === 'play-pause' || command === 'next' || command === 'prev') {
            chrome.tabs.sendMessage(tabs[0].id, { type: 'YTMS_MEDIA_CONTROL', action: command });
        }
    });
});
