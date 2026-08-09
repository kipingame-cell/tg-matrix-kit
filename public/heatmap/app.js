let rawData = [];
let chart = null;
const colors = ['#00ffff', '#cc0000', '#A6E22E', '#FD971F', '#AE81FF', '#E6DB74', '#f06595', '#20c997'];

async function init() {
    try {
        const file = new URLSearchParams(window.location.search).get('file');
        if(!file) return alert("ДАННЫЕ ТЕЛЕМЕТРИИ НЕ НАЙДЕНЫ");
        const res = await fetch(file);
        rawData = await res.json();

        if(!Array.isArray(rawData)) return alert("ОБНАРУЖЕН СТАРЫЙ ДАМП. СДЕЛАЙТЕ НОВЫЙ ЭКСПОРТ ИЗ ПАНЕЛИ.");

        const users = [...new Set(rawData.map(d => d.user))].sort();
        const cont = document.getElementById('users_container');
        cont.innerHTML = '';
        users.forEach((u, i) => {
            const l = document.createElement('label');
            l.style.display = 'block';
            l.innerHTML = `<input type="checkbox" value="${u}" checked> <span style="color:${colors[i % colors.length]}">${u}</span>`;
            l.querySelector('input').onchange = render;
            cont.appendChild(l);
        });
        render();
    } catch(e) {
        document.body.innerHTML += `<div style="color:red; padding:20px;">КРИТИЧЕСКИЙ СБОЙ: ${e.message}</div>`;
    }
}

function render() {
    const resNode = document.getElementById('time_res') || document.getElementById('grouping');
    const mode = resNode ? resNode.value : 'hour';
    const selected = Array.from(document.querySelectorAll('#users_container input:checked')).map(c => c.value);
    const labels = new Set();

    const datasets = selected.map((u, idx) => {
        const stats = {};
        rawData.filter(d => d.user === u).forEach(d => {
            const dt = new Date(d.ts);
            let k;
            if(mode==='hour') k = dt.toISOString().slice(0,13)+':00';
            else if(mode==='day') k = dt.toISOString().slice(0,10);
            else if(mode==='month') k = dt.toISOString().slice(0,7);
            else if(mode==='year') k = dt.getFullYear().toString();
            else k = dt.toISOString().slice(0,16).replace('T',' ');
            stats[k] = (stats[k] || 0) + 1;
            labels.add(k);
        });
        return { label: u, stats, color: colors[idx % colors.length] };
    });

    const sortedLabels = Array.from(labels).sort();
    const finalDS = datasets.map(ds => ({
        label: ds.label,
        data: sortedLabels.map(l => ds.stats[l] || 0),
        borderColor: ds.color,
        backgroundColor: ds.color + '22',
        fill: true, tension: 0.3, pointRadius: 2
    }));

    const canvas = document.getElementById('mainChart') || document.getElementById('activityChart');
    if(chart) chart.destroy();
    chart = new Chart(canvas, {
        type: 'line',
        data: { labels: sortedLabels, datasets: finalDS },
        options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            scales: { x: { grid: {color:'#333'}, ticks: {color:'#aaa'} }, y: { grid: {color:'#333'}, ticks: {color:'#aaa'} } },
            plugins: { legend: { display: false } }
        }
    });
}

const timeSelector = document.getElementById('time_res') || document.getElementById('grouping');
if(timeSelector) timeSelector.onchange = render;

const btnAll = document.getElementById('btn_all');
if(btnAll) btnAll.onclick = () => { document.querySelectorAll('input').forEach(i=>i.checked=true); render(); };

const btnNone = document.getElementById('btn_none');
if(btnNone) btnNone.onclick = () => { document.querySelectorAll('input').forEach(i=>i.checked=false); render(); };

init();
