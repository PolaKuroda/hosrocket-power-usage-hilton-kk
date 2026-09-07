import React, {useEffect, useMemo, useRef, useState} from 'react';
import {Alert, Button, Col, Container, Form, Nav, Navbar, Row, Spinner} from 'react-bootstrap';
import {FontAwesomeIcon} from '@fortawesome/react-fontawesome';
import {faDownload} from '@fortawesome/free-solid-svg-icons/faDownload';
import {faFilePdf} from '@fortawesome/free-solid-svg-icons/faFilePdf';
import {faGaugeHigh} from '@fortawesome/free-solid-svg-icons/faGaugeHigh';
import {faImage} from '@fortawesome/free-solid-svg-icons/faImage';
import {faSliders} from '@fortawesome/free-solid-svg-icons/faSliders';
import {Chart, ChartConfiguration} from 'chart.js/auto';
import Papa from 'papaparse';
import {jsPDF} from 'jspdf';

type PowerRow = {
	SITE_TIME: string;
	room_slug: string;
	device_group: string;
	channel: string;
	voltage: string;
	current: string;
	active_power: string;
	reactive_power: string;
	total_energy: string;
	power_factor: string;
};

type Metric = keyof Pick<PowerRow, 'voltage' | 'current' | 'active_power' | 'reactive_power' | 'total_energy' | 'power_factor'>;

const metrics: {key: Metric; label: string; unit: string; color: string}[] = [
	{key: 'voltage', label: 'Voltage', unit: 'V', color: '#2b6bbf'},
	{key: 'current', label: 'Current', unit: 'A', color: '#ffa647'},
	{key: 'active_power', label: 'Active Power', unit: 'kW', color: '#27AE60'},
	{key: 'reactive_power', label: 'Reactive Power', unit: 'kVAR', color: '#504f78'},
	{key: 'total_energy', label: 'Current Total Energy', unit: 'kWh', color: '#fc7b7b'},
	{key: 'power_factor', label: 'Power Factor', unit: '', color: '#6d6d6d'}
];

const timePeriods = [
	{value: 'all', label: 'All available'},
	{value: '24h', label: 'Last 24 hours'},
	{value: '7d', label: 'Last 7 days'}
];

function displayTime(value: string): string {
	return value.replace(/\sUTC$/, '');
}

export function App(): JSX.Element {
	const [rows, setRows] = useState<PowerRow[]>([]);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [room, setRoom] = useState('all');
	const [period, setPeriod] = useState('all');
	const [deviceGroup, setDeviceGroup] = useState('all');
	const [channel, setChannel] = useState('all');
	const [selectedMetrics, setSelectedMetrics] = useState<Metric[]>(['active_power', 'total_energy']);
	const chartCanvas = useRef<HTMLCanvasElement>(null);
	const chart = useRef<Chart | null>(null);

	useEffect(() => {
		fetch('/output/power_usage_preview.csv')
			.then((response) => {
				if (!response.ok) throw new Error('Unable to load the prepared power usage CSV.');
				return response.text();
			})
			.then((csv) => {
				const result = Papa.parse<PowerRow>(csv, {header: true, skipEmptyLines: true});
				if (result.errors.length > 0) throw new Error(result.errors[0].message);
				setRows(result.data);
			})
			.catch((error: Error) => setLoadError(error.message));
	}, []);

	const rooms = useMemo(() => [...new Set(rows.map((row) => row.room_slug))].sort(), [rows]);
	const groups = useMemo(() => [...new Set(rows.map((row) => row.device_group))].sort(), [rows]);
	const channels = useMemo(() => [...new Set(rows.map((row) => row.channel))].sort(), [rows]);

	const filteredRows = useMemo(() => {
		const periodStart = period === '24h' ? Date.now() - 24 * 60 * 60 * 1000 : period === '7d' ? Date.now() - 7 * 24 * 60 * 60 * 1000 : 0;
		return rows.filter((row) => {
			const time = Date.parse(displayTime(row.SITE_TIME).replace(' ', 'T'));
			return (room === 'all' || row.room_slug === room) &&
				(deviceGroup === 'all' || row.device_group === deviceGroup) &&
				(channel === 'all' || row.channel === channel) &&
				(periodStart === 0 || time >= periodStart);
		});
	}, [rows, room, period, deviceGroup, channel]);

	useEffect(() => {
		if (!chartCanvas.current || filteredRows.length === 0 || selectedMetrics.length === 0) return;
		chart.current?.destroy();
		const labels = filteredRows.map((row) => displayTime(row.SITE_TIME));
		const datasets = selectedMetrics.map((metric) => {
			const definition = metrics.find((item) => item.key === metric)!;
			return {
				label: `${definition.label}${definition.unit ? ` (${definition.unit})` : ''}`,
				data: filteredRows.map((row) => Number(row[metric])),
				borderColor: definition.color,
				backgroundColor: definition.color,
				borderWidth: 2,
				pointRadius: filteredRows.length > 100 ? 0 : 2,
				tension: 0.25,
				fill: false
			};
		});
		const configuration: ChartConfiguration = {
			type: 'line',
			data: {labels, datasets},
			options: {
				responsive: true,
				maintainAspectRatio: false,
				interaction: {mode: 'index', intersect: false},
				plugins: {legend: {position: 'bottom', labels: {usePointStyle: true, padding: 20}}, tooltip: {padding: 10}},
				scales: {x: {grid: {display: false}, ticks: {maxTicksLimit: 8, maxRotation: 0}}, y: {beginAtZero: true, grid: {color: '#ecf0f1'}}}
			}
		};
		chart.current = new Chart(chartCanvas.current, configuration);
		return () => chart.current?.destroy();
	}, [filteredRows, selectedMetrics]);

	const toggleMetric = (metric: Metric) => setSelectedMetrics((current) => current.includes(metric) ? current.filter((item) => item !== metric) : [...current, metric]);
	const title = `Room ${room === 'all' ? 'All Rooms' : room} - Power Usage`;

	const exportPng = () => {
		if (!chart.current) return;
		const link = document.createElement('a');
		link.download = `${title.toLowerCase().replaceAll(' ', '-')}.png`;
		link.href = chart.current.toBase64Image();
		link.click();
	};

	const exportPdf = () => {
		if (!chart.current) return;
		const pdf = new jsPDF({orientation: 'landscape', unit: 'mm', format: 'a4'});
		pdf.setFontSize(16);
		pdf.text(title, 15, 16);
		pdf.addImage(chart.current.toBase64Image(), 'PNG', 15, 24, 267, 145);
		pdf.save(`${title.toLowerCase().replaceAll(' ', '-')}.pdf`);
	};

	return <>
		<Navbar className="topbar" sticky="top">
			<Container fluid="xl">
				<Navbar.Brand className="brand"><FontAwesomeIcon icon={faGaugeHigh} className="me-2" />HOSROCKET</Navbar.Brand>
				<Nav className="ms-auto align-items-center"><span className="operator-label">POWER MONITORING</span><Button variant="link" className="download-button" title="Download prepared data"><FontAwesomeIcon icon={faDownload} /></Button></Nav>
			</Container>
		</Navbar>
		<Container fluid="xl" className="app-container">
			<Row>
				<Col lg={2} className="sidebar d-none d-lg-block">
					<div className="sidebar-inner"><div className="sidebar-heading">OPERATIONS</div><Nav className="flex-column"><Nav.Link className="active"><FontAwesomeIcon icon={faGaugeHigh} className="me-2" />Power usage</Nav.Link><Nav.Link disabled>Room status</Nav.Link><Nav.Link disabled>Energy reports</Nav.Link></Nav><div className="sidebar-heading mt-4">SYSTEM</div><Nav className="flex-column"><Nav.Link disabled>Site settings</Nav.Link><Nav.Link disabled>Audit log</Nav.Link></Nav></div>
				</Col>
				<Col xs={12} lg={10} as="main" className="main-content">
					<div className="page-header"><div><div className="eyebrow">BUILDING MANAGEMENT SYSTEM / ENERGY</div><h1>{title}</h1><p>Electrical telemetry from room power meters</p></div><div className="record-count">{filteredRows.length.toLocaleString()} readings</div></div>
					{loadError && <Alert variant="danger">{loadError}</Alert>}
					<section className="control-panel" aria-label="Chart filters">
						<div className="panel-heading"><span><FontAwesomeIcon icon={faSliders} className="me-2" />Chart options</span><span className="small-muted">{rows.length.toLocaleString()} total readings</span></div>
						<Row className="g-3">
							<Col md={6} xl={3}><Form.Label>Data source</Form.Label><Form.Select value="prepared" disabled><option value="prepared">Power usage preview CSV</option></Form.Select></Col>
							<Col md={6} xl={2}><Form.Label>Time period</Form.Label><Form.Select value={period} onChange={(event) => setPeriod(event.target.value)}>{timePeriods.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</Form.Select></Col>
							<Col md={4} xl={2}><Form.Label>Room</Form.Label><Form.Select value={room} onChange={(event) => setRoom(event.target.value)}><option value="all">All rooms</option>{rooms.map((item) => <option key={item} value={item}>{item}</option>)}</Form.Select></Col>
							<Col md={4} xl={2}><Form.Label>Device group</Form.Label><Form.Select value={deviceGroup} onChange={(event) => setDeviceGroup(event.target.value)}><option value="all">All groups</option>{groups.map((item) => <option key={item} value={item}>Group {item}</option>)}</Form.Select></Col>
							<Col md={4} xl={2}><Form.Label>Channel</Form.Label><Form.Select value={channel} onChange={(event) => setChannel(event.target.value)}><option value="all">All channels</option>{channels.map((item) => <option key={item} value={item}>Channel {item}</option>)}</Form.Select></Col>
						</Row>
						<div className="metric-picker"><Form.Label>Data to chart</Form.Label><div className="metric-options">{metrics.map((metric) => <Form.Check key={metric.key} type="checkbox" id={`metric-${metric.key}`} label={`${metric.label}${metric.unit ? ` (${metric.unit})` : ''}`} checked={selectedMetrics.includes(metric.key)} onChange={() => toggleMetric(metric.key)} />)}</div></div>
					</section>
					<section className="chart-card"><div className="chart-toolbar"><div><h2>{title}</h2><span>Local site time · {filteredRows.length.toLocaleString()} points</span></div><div className="export-actions"><Button variant="outline-secondary" size="sm" onClick={exportPng} disabled={!chart.current}><FontAwesomeIcon icon={faImage} className="me-2" />PNG</Button><Button variant="primary" size="sm" onClick={exportPdf} disabled={!chart.current}><FontAwesomeIcon icon={faFilePdf} className="me-2" />PDF</Button></div></div><div className="chart-stage">{rows.length === 0 && !loadError ? <div className="loading"><Spinner animation="border" size="sm" className="me-2" />Loading telemetry...</div> : filteredRows.length === 0 || selectedMetrics.length === 0 ? <div className="empty-state">Select at least one data series and a filter with available readings.</div> : <canvas ref={chartCanvas} aria-label={`${title} chart`} />}</div></section>
				</Col>
			</Row>
		</Container>
	</>;
}