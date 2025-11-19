
// localStorage 键名
const STORAGE_KEYS = {
    WATCH_LIST: 'binance_watch_list',
    ALERT_HISTORY: 'binance_alert_history',
    LAST_ALERT_TIME: 'binance_last_alert_time'
};

// 从 localStorage 加载数据
function loadFromStorage(key, defaultValue) {
    try {
        const data = localStorage.getItem(key);
        return data ? JSON.parse(data) : defaultValue;
    } catch (error) {
        console.error('加载数据失败:', error);
        return defaultValue;
    }
}

// 保存数据到 localStorage
function saveToStorage(key, data) {
    try {
        localStorage.setItem(key, JSON.stringify(data));
    } catch (error) {
        console.error('保存数据失败:', error);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    // DOM 元素
    const connectionStatusEl = document.getElementById('connection-status');
    const watchForm = document.getElementById('watch-form');
    const symbolInput = document.getElementById('symbol-input');
    const lowerPriceInput = document.getElementById('lower-price-input');
    const upperPriceInput = document.getElementById('upper-price-input');
    const watchListBody = document.getElementById('watch-list-body');
    const alertListBody = document.getElementById('alert-list-body');
    const alertSound = document.getElementById('alert-sound');
    const alertModal = new bootstrap.Modal(document.getElementById('alert-modal'));
    const alertModalBody = document.getElementById('alert-modal-body');
    const rawDataLog = document.getElementById('raw-data-log');
    const rawDataCard = document.getElementById('raw-data-card');
    const toggleRawDataSwitch = document.getElementById('toggle-raw-data-switch');

    // 控制原始数据可见性
    toggleRawDataSwitch.addEventListener('change', () => {
        if (toggleRawDataSwitch.checked) {
            rawDataCard.style.display = 'block';
        } else {
            rawDataCard.style.display = 'none';
        }
    });

    // 状态管理 - 从 localStorage 恢复数据
    let watches = loadFromStorage(STORAGE_KEYS.WATCH_LIST, []); // 监控列表
    let alertHistory = loadFromStorage(STORAGE_KEYS.ALERT_HISTORY, []); // 警报历史
    let lastAlertTime = loadFromStorage(STORAGE_KEYS.LAST_ALERT_TIME, {}); // 记录每个交易对最后一次警报时间，防止重复警报
    let currentPrices = {}; // 保存每个交易对的最新价格
    
    // WebSocket URL
    const wsURL = 'wss://fstream.binance.com/stream?streams=!markPrice@arr@1s';
    let socket = null;

    function connectWebSocket() {
        if (socket && socket.readyState === WebSocket.OPEN) {
            return;
        }

        socket = new WebSocket(wsURL);

        socket.onopen = () => {
            console.log('WebSocket 连接成功！');
            connectionStatusEl.textContent = '已连接';
            connectionStatusEl.classList.remove('bg-secondary', 'bg-danger');
            connectionStatusEl.classList.add('bg-success');
        };

        socket.onmessage = (event) => {
            // 在页面上显示原始数据
            if (toggleRawDataSwitch.checked) {
                rawDataLog.textContent = JSON.stringify(JSON.parse(event.data), null, 2);
            }

            const message = JSON.parse(event.data);
            const priceUpdates = message.data;

            // 遍历收到的所有价格更新
            priceUpdates.forEach(update => {
                const symbol = update.s;
                const price = parseFloat(update.p);
                
                // 更新当前价格
                currentPrices[symbol] = price;

                // 检查是否在监控列表中
                const watch = watches.find(w => w.symbol === symbol);
                if (watch) {
                    // 更新监控列表中的实时价格
                    const priceCell = document.getElementById(`price-${symbol}`);
                    if (priceCell) {
                        priceCell.textContent = price.toFixed(4);
                        // 检查价格是否在范围内并更新样式
                        if (price < watch.lower || price > watch.upper) {
                            priceCell.classList.add('price-out-of-range');
                        } else {
                            priceCell.classList.remove('price-out-of-range');
                        }
                    }

                    // 检查是否触发警报
                    const isOutOfRange = price > watch.upper || price < watch.lower;
                    if (isOutOfRange) {
                        // 触发警报并从监控列表中移除
                        triggerAlert(watch, price);
                        
                        // 从监控列表中删除该交易对
                        watches = watches.filter(w => w.symbol !== symbol);
                        saveToStorage(STORAGE_KEYS.WATCH_LIST, watches);
                        renderWatchList();
                        
                        // 重新连接 WebSocket（更新订阅列表）
                        if (socket) {
                            socket.close();
                        }
                        if (watches.length > 0) {
                            connectWebSocket();
                        }
                    }
                }
            });
        };

        socket.onclose = () => {
            console.log('WebSocket 连接已断开，尝试重新连接...');
            connectionStatusEl.textContent = '已断开';
            connectionStatusEl.classList.remove('bg-success');
            connectionStatusEl.classList.add('bg-danger');
            // 简单重连机制
            setTimeout(connectWebSocket, 5000);
        };

        socket.onerror = (error) => {
            console.error('WebSocket 错误:', error);
            socket.close();
        };
    }

    // 触发警报
    function triggerAlert(watch, price) {
        console.log(`警报! ${watch.symbol} 价格 ${price} 超出范围 (${watch.lower} - ${watch.upper})`);
        
        const alertType = price < watch.lower ? '低于下限' : '高于上限';
        const alertTime = new Date().toLocaleString('zh-CN');
        
        // 1. 更新弹窗内容并显示
        alertModalBody.innerHTML = `
            <strong>${watch.symbol}</strong><br>
            当前价格: <span class="text-danger">${price.toFixed(4)}</span><br>
            ${alertType}
        `;
        alertModal.show();
        
        // 2. 播放提示音
        alertSound.play().catch(e => console.error("音频播放失败:", e));
        
        // 3. 添加到警报历史
        const alert = {
            time: alertTime,
            symbol: watch.symbol,
            price: price,
            type: alertType
        };
        
        alertHistory.unshift(alert);
        
        // 限制警报历史最多保存50条
        if (alertHistory.length > 50) {
            alertHistory = alertHistory.slice(0, 50);
        }
        
        // 保存到 localStorage
        saveToStorage(STORAGE_KEYS.ALERT_HISTORY, alertHistory);
        
        // 4. 更新警报列表显示
        renderAlertHistory();
    }

    // 渲染监控列表
    function renderWatchList() {
        if (watches.length === 0) {
            watchListBody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">暂无监控项，请添加交易对</td></tr>';
            return;
        }
        
        watchListBody.innerHTML = '';
        watches.forEach((watch, index) => {
            const price = currentPrices[watch.symbol] ? currentPrices[watch.symbol].toFixed(4) : '等待数据...';
            const isOutOfRange = currentPrices[watch.symbol] && 
                (currentPrices[watch.symbol] < watch.lower || currentPrices[watch.symbol] > watch.upper);
            
            const row = document.createElement('tr');
            row.innerHTML = `
                <td><strong>${watch.symbol}</strong></td>
                <td id="price-${watch.symbol}" class="${isOutOfRange ? 'price-out-of-range' : ''}">${price}</td>
                <td>${watch.lower}</td>
                <td>${watch.upper}</td>
                <td><button class="btn btn-sm btn-danger" data-index="${index}">删除</button></td>
            `;
            watchListBody.appendChild(row);
        });
    }

    // 渲染警报历史
    function renderAlertHistory() {
        if (alertHistory.length === 0) {
            alertListBody.innerHTML = '<tr><td colspan="4" class="text-center text-muted">暂无警报记录</td></tr>';
            return;
        }
        
        alertListBody.innerHTML = '';
        // 只显示最近20条
        alertHistory.slice(0, 20).forEach((alert, index) => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${alert.time}</td>
                <td><strong>${alert.symbol}</strong> (${alert.type})</td>
                <td class="text-danger fw-bold">${alert.price.toFixed(4)}</td>
                <td><button class="btn btn-sm btn-outline-danger delete-alert" data-index="${index}">删除</button></td>
            `;
            alertListBody.appendChild(row);
        });
    }

    // 处理表单提交
    watchForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const symbol = symbolInput.value.toUpperCase().trim();
        const lower = parseFloat(lowerPriceInput.value);
        const upper = parseFloat(upperPriceInput.value);

        if (!symbol || isNaN(lower) || isNaN(upper) || lower >= upper) {
            alert('请输入有效的交易对和价格范围，且下限必须小于上限！');
            return;
        }

        // 检查是否已存在
        if (watches.some(w => w.symbol === symbol)) {
            alert(`${symbol} 已经在监控列表中！`);
            return;
        }

        watches.push({ symbol, lower, upper });
        
        // 保存到 localStorage
        saveToStorage(STORAGE_KEYS.WATCH_LIST, watches);
        
        renderWatchList();
        watchForm.reset();
    });

    // 处理监控列表删除按钮点击（事件委托）
    watchListBody.addEventListener('click', (e) => {
        if (e.target.tagName === 'BUTTON' && e.target.classList.contains('btn-danger')) {
            const index = parseInt(e.target.getAttribute('data-index'));
            const symbol = watches[index].symbol;
            
            if (confirm(`确定要删除 ${symbol} 的监控吗？`)) {
                watches.splice(index, 1);
                
                // 保存到 localStorage
                saveToStorage(STORAGE_KEYS.WATCH_LIST, watches);
                
                renderWatchList();
            }
        }
    });

    // 处理警报列表删除按钮点击（事件委托）
    alertListBody.addEventListener('click', (e) => {
        if (e.target.tagName === 'BUTTON' && e.target.classList.contains('delete-alert')) {
            const index = parseInt(e.target.getAttribute('data-index'));
            
            alertHistory.splice(index, 1);
            
            // 保存到 localStorage
            saveToStorage(STORAGE_KEYS.ALERT_HISTORY, alertHistory);
            
            renderAlertHistory();
        }
    });

    // 清空全部警报记录
    document.getElementById('clear-all-alerts').addEventListener('click', () => {
        if (alertHistory.length === 0) {
            return;
        }
        
        if (confirm('确定要清空所有警报记录吗？')) {
            alertHistory = [];
            
            // 保存到 localStorage
            saveToStorage(STORAGE_KEYS.ALERT_HISTORY, alertHistory);
            
            renderAlertHistory();
        }
    });

    // 页面加载时初始化
    renderWatchList();
    renderAlertHistory();
    
    // 启动 WebSocket 连接
    connectWebSocket();
    
    // 页面关闭前清理
    window.addEventListener('beforeunload', () => {
        if (socket) {
            socket.close();
        }
    });
});