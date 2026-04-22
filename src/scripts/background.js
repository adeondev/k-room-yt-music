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
});

chrome.commands.onCommand.addListener((command) => {
    chrome.tabs.query({ url: '*://music.youtube.com/*' }, (tabs) => {
        if (!tabs || tabs.length === 0) return;
        if (command === 'play-pause' || command === 'next' || command === 'prev') {
            chrome.tabs.sendMessage(tabs[0].id, { type: 'YTMS_MEDIA_CONTROL', action: command });
        }
    });
});
