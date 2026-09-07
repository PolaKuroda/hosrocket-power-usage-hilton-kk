import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {basename, dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

type CsvRow = Record<string, string>;

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectDirectory = resolve(scriptDirectory, '..');
const defaultInputPath = resolve(projectDirectory, 'data');
const defaultOutputPath = resolve(projectDirectory, 'output/power_usage_preview.csv');

const outputColumns = [
	'SITE_TIME',
	'room_slug',
	'rcu_ip',
	'time',
	'notify_code',
	'raw_payload',
	'device_group',
	'channel',
	'voltage',
	'current',
	'active_power',
	'reactive_power',
	'total_energy',
	'power_factor'
];

function parseCsv(content: string): CsvRow[] {
	const records: string[][] = [];
	let record: string[] = [];
	let field = '';
	let quoted = false;

	for (let index = 0; index < content.length; index += 1) {
		const character = content[index];
		const nextCharacter = content[index + 1];

		if (character === '"') {
			if (quoted && nextCharacter === '"') {
				field += '"';
				index += 1;
			} else {
				quoted = !quoted;
			}
		} else if (character === ',' && !quoted) {
			record.push(field);
			field = '';
		} else if ((character === '\n' || character === '\r') && !quoted) {
			if (character === '\r' && nextCharacter === '\n') {
				index += 1;
			}
			record.push(field);
			if (record.some((value) => value !== '')) {
				records.push(record);
			}
			record = [];
			field = '';
		} else {
			field += character;
		}
	}

	if (field !== '' || record.length > 0) {
		record.push(field);
		records.push(record);
	}

	const [header, ...rows] = records;
	if (!header || header.length === 0) {
		throw new Error('Input CSV has no header');
	}

	return rows.map((values, rowIndex) => {
		if (values.length !== header.length) {
			throw new Error(`Row ${rowIndex + 2} has ${values.length} fields; expected ${header.length}`);
		}

		return Object.fromEntries(header.map((name, index) => [name, values[index]]));
	});
}

function escapeCsv(value: string | number): string {
	const text = String(value);
	return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function encodeCsv(rows: CsvRow[]): string {
	return [
		outputColumns.join(','),
		...rows.map((row) => outputColumns.map((column) => escapeCsv(row[column] ?? '')).join(','))
	].join('\n') + '\n';
}

function byteAt(payload: string, index: number, rowNumber: number): number {
	const bytes = payload.match(/[0-9a-f]{2}/gi);
	if (!bytes || bytes.length <= index || bytes.some((value) => !/^[0-9a-f]{2}$/i.test(value))) {
		throw new Error(`Row ${rowNumber} has an invalid payload: ${payload}`);
	}

	return parseInt(bytes[index], 16);
}

function readUnsigned(payload: string, indexes: number[], rowNumber: number): number {
	return indexes.reduce((value, index) => (value * 256) + byteAt(payload, index, rowNumber), 0);
}

function readScaled(payload: string, indexes: number[], rowNumber: number): string {
	return (readUnsigned(payload, indexes, rowNumber) / 100).toFixed(2);
}

function prepareRow(row: CsvRow, rowNumber: number): CsvRow {
	const payload = row.raw_payload?.trim();
	if (!payload || !/^[0-9a-f]+$/i.test(payload) || payload.length % 2 !== 0 || payload.length < 46) {
		throw new Error(`Row ${rowNumber} has an invalid raw_payload`);
	}

	const activePower = readUnsigned(payload, [17, 18], rowNumber) / 100;
	const reactivePower = readUnsigned(payload, [15, 16], rowNumber) / 100;
	const powerFactor = reactivePower === 0 ? 1 : Math.min(1, Math.max(0, activePower / reactivePower));

	return {
		SITE_TIME: row.SITE_TIME,
		room_slug: row.room_slug,
		rcu_ip: row.rcu_ip,
		time: row.time,
		notify_code: row.notify_code,
		raw_payload: payload,
		device_group: String(byteAt(payload, 7, rowNumber) - 1),
		channel: String(byteAt(payload, 10, rowNumber)),
		voltage: readScaled(payload, [11, 12], rowNumber),
		current: readScaled(payload, [13, 14], rowNumber),
		active_power: activePower.toFixed(2),
		reactive_power: reactivePower.toFixed(2),
		total_energy: readScaled(payload, [21, 22, 19, 20], rowNumber),
		power_factor: powerFactor.toFixed(4)
	};
}

async function findInputCsv(inputPath: string): Promise<string> {
	const entries = await (await import('node:fs/promises')).readdir(inputPath, {withFileTypes: true});
	const csvFile = entries.find((entry) => entry.isFile() && entry.name.endsWith('.csv'));
	if (!csvFile) {
		throw new Error(`No CSV file found in ${inputPath}`);
	}

	return resolve(inputPath, csvFile.name);
}

async function main(): Promise<void> {
	const inputArgument = process.argv[2];
	const outputPath = process.argv[3] ? resolve(process.argv[3]) : defaultOutputPath;
	const inputPath = inputArgument ? resolve(inputArgument) : await findInputCsv(defaultInputPath);
	const input = await readFile(inputPath, 'utf8');
	const rows = parseCsv(input).map((row, index) => prepareRow(row, index + 2));

	await mkdir(dirname(outputPath), {recursive: true});
	await writeFile(outputPath, encodeCsv(rows), 'utf8');
	console.log(`Prepared ${rows.length} rows from ${basename(inputPath)} into ${outputPath}`);
}

await main();