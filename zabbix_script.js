const CLogger = function(serviceName) {
	this.serviceName = serviceName;
	this.INFO = 4
	this.WARN = 3
	this.ERROR = 2
	this.log = function(level, msg) {
		Zabbix.log(level, '[' + this.serviceName + '] ' + msg);
	}
}

const CWebhook = function(value) {
	try {
		params = JSON.parse(value);

		if (['0', '1', '2', '3', '4'].indexOf(params.event_source) === -1) {
			throw 'Incorrect "event_source" parameter given: ' + params.event_source + '.\nMust be 0-4.';
		}

		if (['0', '3', '4'].indexOf(params.event_source) !== -1 && ['0', '1'].indexOf(params.event_value) === -1) {
			throw 'Incorrect "event_value" parameter given: ' + params.event_value + '.\nMust be 0 or 1.';
		}

		if (['0', '3', '4'].indexOf(params.event_source) !== -1) {
			if (params.event_source === '1' && ['0', '1', '2', '3'].indexOf(params.event_value) === -1) {
				throw 'Incorrect "event_value" parameter given: ' + params.event_value + '.\nMust be 0-3.';
			}

			if (params.event_source === '0' && ['0', '1'].indexOf(params.event_update_status) === -1) {
				throw 'Incorrect "event_update_status" parameter given: ' + params.event_update_status + '.\nMust be 0 or 1.';
			}

			if (params.event_source === '4') {
				if (['0', '1', '2', '3', '4', '5'].indexOf(params.event_update_nseverity) !== -1 && params.event_update_nseverity != params.event_nseverity) {
					params.event_nseverity = params.event_update_nseverity;
					params.event_severity = params.event_update_severity;
					params.event_update_status = '1';
				}
			}
		}

		this.runCallback = function(name, params) {
			if (typeof this[name] === 'function') {
				return this[name].apply(this, [params]);
			}
		}

		this.handleEvent = function(source, event) {
			const alert = { source: source, event: event };
			return [
				this.runCallback('on' + source + event, alert),
				this.runCallback('on' + event, alert),
				this.runCallback('onEvent', alert)
			];
		}

		this.handleEventless = function(source) {
			const alert = { source: source, event: null };
			return [
				this.runCallback('on' + source, alert),
				this.runCallback('onEvent', alert)
			];
		}

		this.run = function() {
			var results = [];
			if (typeof this.httpProxy === 'string' && this.httpProxy.trim() !== '') {
				this.request.setProxy(this.httpProxy);
			}
			const types = { '0': 'Trigger', '1': 'Discovery', '2': 'Autoreg', '3': 'Internal', '4': 'Service' };

			if (['0', '3', '4'].indexOf(this.params.event_source) !== -1) {
				var event = (this.params.event_update_status === '1')
					? 'Update'
					: ((this.params.event_value === '1') ? 'Problem' : 'Resolve');

				results = this.handleEvent(types[this.params.event_source], event);
			}
			else if (typeof types[this.params.event_source] !== 'undefined') {
				results = this.handleEventless(types[this.params.event_source]);
			}
			else {
				throw 'Unexpected "event_source": ' + this.params.event_source;
			}

			for (idx in results) {
				if (typeof results[idx] !== 'undefined') {
					return JSON.stringify(results[idx]);
				}
			}
		}
		this.httpProxy = params.http_proxy;
		this.params = params;
		this.runCallback('onCheckParams', {});
	} catch (error) {
		throw 'Webhook processing failed: ' + error;
	}
}

const CParamValidator = {

	isType: function(value, type) {
		if (type === 'array') {
			return Array.isArray(value);
		}
		if (type === 'integer') {
			return CParamValidator.isInteger(value);
		}
		if (type === 'float') {
			return CParamValidator.isFloat(value);
		}

		return (typeof value === type);
	},

	isInteger: function(value) {
		if (!CParamValidator.ifMatch(value, /^-?\d+$/)) {
			return false;
		}

		return !isNaN(parseInt(value));
	},

	isFloat: function(value) {
		if (!CParamValidator.ifMatch(value, /^-?\d+\.\d+$/)) {
			return false;
		}

		return !isNaN(parseFloat(value));
	},

	isDefined: function(value) {
		return !CParamValidator.isType(value, 'undefined');
	},

	isEmpty: function(value) {
		if (!CParamValidator.isType(value, 'string')) {
			throw 'Value "' + value + '" must be a string to be checked for emptiness.';
		}

		return (value.trim() === '');
	},

	isMacroSet: function(value, macro) {
		if (CParamValidator.isDefined(macro)) {
			return !(CParamValidator.ifMatch(value, '^\{' + macro + '\}$'))
		}

		return !(CParamValidator.ifMatch(value, '^\{[$#]{0,1}[A-Z_\.]+[\:]{0,1}["]{0,1}.*["]{0,1}\}$') || value === '*UNKNOWN*')
	},

	withinRange: function(value, min, max) {
		if (!CParamValidator.isType(value, 'number')) {
			throw 'Value "' + value + '" must be a number to be checked for range.';
		}
		if (value < ((CParamValidator.isDefined(min)) ? min : value)
			|| value > ((CParamValidator.isDefined(max)) ? max : value)) {
			return false;
		}

		return true;
	},

	inArray: function(value, array) {
		if (!CParamValidator.isType(array, 'array')) {
			throw 'The array must be an array to check the value for existing in it.';
		}

		return (array.indexOf((typeof value === 'string') ? value.toLowerCase() : value) !== -1);
	},

	ifMatch: function(value, regex) {
		return (new RegExp(regex)).test(value);
	},

	match: function(value, regex) {
		if (!CParamValidator.isType(value, 'string')) {
			throw 'Value "' + value + '" must be a string to be matched with the regular expression.';
		}

		return value.match(new RegExp(regex));
	},

	checkURL: function(value) {
		if (CParamValidator.isEmpty(value)) {
			throw 'URL value "' + value + '" must be a non-empty string.';
		}
		if (!CParamValidator.ifMatch(value, '^(http|https):\/\/.+')) {
			throw 'URL value "' + value + '" must contain a schema.';
		}

		return value.endsWith('/') ? value.slice(0, -1) : value;
	},

	check: function(key, rule, params) {
		if (!CParamValidator.isDefined(rule.type)) {
			throw 'Mandatory attribute "type" has not been defined for parameter "' + key + '".';
		}
		if (!CParamValidator.isDefined(params[key])) {
			throw 'Checked parameter "' + key + '" was not found in the list of input parameters.';
		}
		var value = params[key],
			error_message = null;
		switch (rule.type) {
			case 'string':
				if (!CParamValidator.isType(value, 'string')) {
					throw 'Value "' + key + '" must be a string.';
				}
				if (CParamValidator.isEmpty(value)) {
					error_message = 'Value "' + key + '" must be a non-empty string';
					break;
				}
				if (CParamValidator.isDefined(rule.len) && value.length < rule.len) {
					error_message = 'Value "' + key + '" must be a string with a length > ' + rule.len;
				}
				if (CParamValidator.isDefined(rule.regex) && !CParamValidator.ifMatch(value, rule.regex)) {
					error_message = 'Value "' + key + '" must match the regular expression "' + rule.regex + '"';
				}
				if (CParamValidator.isDefined(rule.url) && rule.url === true) {
					value = CParamValidator.checkURL(value);
				}
				break;
			case 'integer':
				if (!CParamValidator.isInteger(value)) {
					error_message = 'Value "' + key + '" must be an integer';
					break;
				}
				value = parseInt(value);
				break;
			case 'float':
				if (!CParamValidator.isFloat(value)) {
					error_message = 'Value "' + key + '" must be a floating-point number';
					break;
				}
				value = parseFloat(value);
				break;
			case 'boolean':
				if (CParamValidator.inArray(value, ['1', 'true', 'yes', 'on'])) {
					value = true;
				}
				else if (CParamValidator.inArray(value, ['0', 'false', 'no', 'off'])) {
					value = false;
				}
				else {
					error_message = 'Value "' + key + '" must be a boolean-like.';
				}
				break;
			case 'array':
				try {
					value = JSON.parse(value);
				} catch (error) {
					throw 'Value "' + key + '" contains invalid JSON.';
				}
				if (!CParamValidator.isType(value, 'array')) {
					error_message = 'Value "' + key + '" must be an array.';
				}
				if (CParamValidator.isDefined(rule.tags) && rule.tags === true) {
					value = value.reduce(function(acc, obj) {
						acc[obj.tag] = obj.value || null;
						return acc;
					}, {});
				}
				break;
			case 'object':
				value = JSON.parse(value);
				if (!CParamValidator.isType(value, 'object')) {
					error_message = 'Value "' + key + '" must be an object.';
				}
				break;
			default:
				throw 'Unexpected attribute type "' + rule.type + '" for value "' + key + '". Available: ' +
				['integer', 'float', 'string', 'boolean', 'array', 'object'].join(', ');
		}
		params[key] = value;
		if (CParamValidator.inArray(rule.type, ['integer', 'float']) && error_message === null && (CParamValidator.isDefined(rule.min)
			|| CParamValidator.isDefined(rule.max)) && !CParamValidator.withinRange(value, rule.min, rule.max)) {
			error_message = 'Value "' + key + '" must be a number ' + ((CParamValidator.isDefined(rule.min) && CParamValidator.isDefined(rule.max))
				? (rule.min + '..' + rule.max) : ((CParamValidator.isDefined(rule.min)) ? '>' + rule.min : '<' + rule.max));
		}
		else if (CParamValidator.isDefined(rule.array) && !CParamValidator.inArray(value, rule.array)) {
			error_message = 'Value "' + key + '" must be in the array ' + JSON.stringify(rule.array);
		}
		else if (CParamValidator.isDefined(rule.macro) && !CParamValidator.isMacroSet(value.toString(), rule.macro)) {
			error_message = 'The macro ' + ((CParamValidator.isDefined(rule.macro)) ? '{' + rule.macro + '} ' : ' ') + 'is not set';
		}
		if (error_message !== null) {
			if (CParamValidator.isDefined(rule.default) && CParamValidator.isType(rule.default, rule.type)) {
				params[key] = rule.default;
			}
			else {
				Zabbix.log(4, 'Default value for "' + key + '" must be a ' + rule.type + '. Skipped.');
				throw 'Incorrect value for variable "' + key + '". ' + error_message;
			}
		}

		return this;
	},

	validate: function(rules, params) {
		if (!CParamValidator.isType(params, 'object') || CParamValidator.isType(params, 'array')) {
			throw 'Incorrect parameters value. The value must be an object.';
		}
		for (var key in rules) {
			CParamValidator.check(key, rules[key], params);
		}
	}
}

const CHttpRequest = function(logger) {
	this.request = new HttpRequest();
	if (typeof logger !== 'object' || logger === null) {
		this.logger = Zabbix;
	}
	else {
		this.logger = logger;
	}

	this.clearHeader = function() {
		this.request.clearHeader();
	}

	this.addHeaders = function(value) {
		var headers = [];

		if (typeof value === 'object' && value !== null) {
			if (!Array.isArray(value)) {
				Object.keys(value).forEach(function(key) {
					headers.push(key + ': ' + value[key]);
				});
			}
			else {
				headers = value;
			}
		}
		else if (typeof value === 'string') {
			value.split('\r\n').forEach(function(header) {
				headers.push(header);
			});
		}

		for (var idx in headers) {
			this.request.addHeader(headers[idx]);
		}
	}

	this.setProxy = function(proxy) {
		this.request.setProxy(proxy);
	}

	this.plainRequest = function(method, url, data) {
		var resp = null;
		method = method.toLowerCase();
		this.logger.log(4, 'Sending ' + method + ' request:' + JSON.stringify(data));
		if (['get', 'post', 'put', 'patch', 'delete', 'trace'].indexOf(method) !== -1) {
			resp = this.request[method](url, data);
		}
		else if (['connect', 'head', 'options'].indexOf(method) !== -1) {
			resp = this.request[method](url);
		}
		else {
			throw 'Unexpected method. Method ' + method + ' is not supported.';
		}
		this.logger.log(4, 'Response has been received: ' + resp);

		return resp;
	}

	this.jsonRequest = function(method, url, data) {
		this.addHeaders('Content-Type: application/json');
		var resp = this.plainRequest(method, url, JSON.stringify(data));
		try {
			resp = JSON.parse(resp);
		}
		catch (error) {
			throw 'Failed to parse response: not well-formed JSON was received';
		}

		return resp;
	}

	this.getStatus = function() {
		return this.request.getStatus();
	}
}

const CWebhookHelper = {

	createProblemURL: function(event_source, zabbix_url, trigger_id, event_id) {
		if (event_source === '0') {
			return zabbix_url + '/tr_events.php?triggerid=' + trigger_id + '&eventid=' + event_id;
		} else if (event_source === '4') {
			return zabbix_url + '/zabbix.php?action=service.list';
		}

		return zabbix_url;
	},

};

var serviceLogName = 'Slack Webhook',
	Logger = new CLogger(serviceLogName),
	Slack = CWebhook;

Slack.prototype.onCheckParams = function () {
	CParamValidator.validate({
		alert_subject: { type: 'string' },
		alert_message: { type: 'string' },
		bot_token: { type: 'string' },
		zabbix_url: { type: 'string', url: true },
		channel: { type: 'string', macro: 'ALERT.SENDTO' },
		slack_mode: { type: 'string', array: ['alarm', 'event'], }
	}, this.params);

	if (this.params.event_source === '0') {
		CParamValidator.validate({
			event_id: { type: 'integer' },
			trigger_id: { type: 'integer' }
		}, this.params);
	}

	if (CParamValidator.inArray(this.params.event_source, ['0', '3', '4'])) {
		CParamValidator.validate({
			event_tags: { type: 'array', macro: 'EVENT.TAGSJSON', tags: true, default: {} }
		}, this.params);
	}

	if (this.params.event_value != '0' && CParamValidator.isDefined(this.params.event_tags['__channel_id_' + this.params.channel])) {
		this.params.event_update_status = '1';
	}

	this.severity_colors = [
		'#97AAB3',
		'#7499FF',
		'#FFC859',
		'#FFA059',
		'#E97659',
		'#E45959'
	];

	this.resolve_color = '#009900';
	this.slack_endpoint = 'https://slack.com/api/';

	this.problem_url = CWebhookHelper.createProblemURL(this.params.event_source, this.params.zabbix_url, this.params.trigger_id, this.params.event_id);

	this.data = {
		channel: this.params.channel,
		attachments: [
			{
				fallback: this.params.alert_subject,
				title: this.params.alert_subject,
				color: this.severity_colors[this.params.event_nseverity],
				title_link: this.problem_url,
				text: this.params.alert_message,
				actions: [
					{
						type: 'button',
						text: 'Open in Zabbix',
						url: this.problem_url
					}
				]
			}
		]
	};

	this.reply = {
		channel: this.params.channel,
		thread_ts: '',
		blocks: [
			{
				type: 'context',
				elements: [
					{
						type: 'plain_text',
						text: 'Event update message'
					}
				]
			},
			{
				type: 'rich_text',
				elements: [
					{
						type: 'rich_text_section',
						elements: [
							{
								type: 'text',
								text: '',
								style: {
									italic: true
								}
							}
						]
					}
				]
			}
		]
	};
};

Slack.prototype.sendRequest = function (route, data, tags) {
	this.request.clearHeader();
	this.request.addHeaders({
		'Content-Type': 'application/json; charset=utf-8;',
		'Authorization': 'Bearer ' + this.params.bot_token
	});

	var response = this.request.jsonRequest('POST', this.slack_endpoint + route, data);

	if (this.request.getStatus() !== 200 || !CParamValidator.isType(response.ok, 'boolean') || response.ok !== true) {
		Logger.log(Logger.INFO, 'HTTP code: ' + this.request.getStatus());
		if (CParamValidator.isType(response.error, 'string')) {
			throw 'Endpoint response:' + response.error;
		}
		else {
			throw 'Unknown error. Check debug log for more information.';
		}
	}

	if (tags) {
		return {
			tags: {
				['__message_ts_' + this.params.channel]: response.ts,
				['__channel_id_' + this.params.channel]: response.channel,
				['__message_link_' + this.params.channel]: this.getPermalink(response.channel, response.ts),
			}
		};

	}
	else {
		return { tags: {} };
	}
};

Slack.prototype.getPermalink = function (channel, message_ts) {
	var response = this.request.jsonRequest('GET', this.slack_endpoint + 'chat.getPermalink' + '?channel=' + channel + '&message_ts=' + message_ts);

	if (this.request.getStatus() !== 200 || !CParamValidator.isType(response.ok, 'boolean') || response.ok !== true) {
		Logger.log(Logger.INFO, 'HTTP code: ' + this.request.getStatus());
		if (CParamValidator.isType(response.error, 'string')) {
			throw 'Endpoint response:' + response.error;
		}
		else {
			throw 'Unknown error. Check debug log for more information.';
		}
	}

	if (!CParamValidator.isDefined(response.permalink)) {
		throw 'Permalink is missed from the JSON response';
	}

	return response.permalink;
};

Slack.prototype.onProblem = function (properties) {
	Logger.log(Logger.INFO, 'Source: ' + properties.source + '; Event: ' + properties.event);

	if (this.params.slack_mode === "alarm") {
		return this.sendRequest('chat.postMessage', this.data, true);
	} else {
		return this.sendRequest('chat.postMessage', this.data, false);
	}
};

Slack.prototype.onUpdate = function (properties) {
	Logger.log(Logger.INFO, 'Source: ' + properties.source + '; Event: ' + properties.event);

	if (this.params.slack_mode === "alarm") {
		this.data.channel = this.params.event_tags['__channel_id_' + this.params.channel];
		this.data.ts = this.params.event_tags['__message_ts_' + this.params.channel];

		if (CParamValidator.isMacroSet(this.params.event_update_message, 'EVENT.UPDATE.MESSAGE') && !CParamValidator.isEmpty(this.params.event_update_message)) {
			this.reply.thread_ts = this.data.ts;
			this.reply.blocks[1].elements[0].elements[0].text = this.params.event_update_message;
			this.sendRequest('chat.postMessage', this.reply, false);
		}

		if (/\backnowledged/.test(this.params.event_update_action)) {
			this.sendRequest('reactions.add', { channel: this.data.channel, timestamp: this.data.ts, name: 'white_check_mark' }, false);
		}

		if (/\bunacknowledged/.test(this.params.event_update_action)) {
			this.sendRequest('reactions.remove', { channel: this.data.channel, timestamp: this.data.ts, name: 'white_check_mark' }, false);
		}

		if (/\bclosed/.test(this.params.event_update_action)) {
			return { tags: {} };
		}
		else {
			return this.sendRequest('chat.update', this.data, false);
		}
	} else {
		return this.sendRequest('chat.postMessage', this.data, false);
	}
};

Slack.prototype.onResolve = function (properties) {
	Logger.log(Logger.INFO, 'Source: ' + properties.source + '; Event: ' + properties.event);
	this.data.attachments[0].color = this.resolve_color;

	if (this.params.slack_mode === "alarm") {
		this.data.channel = this.params.event_tags['__channel_id_' + this.params.channel];
		this.data.ts = this.params.event_tags['__message_ts_' + this.params.channel];

		return this.sendRequest('chat.update', this.data, false);
	} else {
		return this.sendRequest('chat.postMessage', this.data, false);
	}
};

Slack.prototype.onDiscovery = function (properties) {
	return this.onProblem(properties);
};

Slack.prototype.onAutoreg = function (properties) {
	return this.onProblem(properties);
};

try {
	var hook = new Slack(value);
	hook.request = new CHttpRequest(Logger);
	return hook.run();
}
catch (error) {
	Logger.log(Logger.WARN, 'Notification failed: ' + error);
	throw 'Sending failed: ' + error;
}
