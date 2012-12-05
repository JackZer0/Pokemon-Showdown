function normaliseSpaces(str) {
	return str.replace(/\s+/g, ' ').trim();
}

function cannotTalk(user, room) {
	if (!user.named) return "You must choose a name to talk.";
	if (user.muted) return "You are muted.";
	if (config.modchat && room.id === 'lobby') {
		if (config.modchat === 'crash') {
			if (!user.can('ignorelimits')) return "Because the server has crashed, you cannot speak in lobby chat.";
		} else {
			if (!user.authenticated && config.modchat === true) {
				return "Because moderated chat is set, you must be registered speak in lobby chat.";
			} else if (config.groupsranking.indexOf(user.group) < config.groupsranking.indexOf(config.modchat)) {
				var groupName = config.groups[config.modchat].name;
				if (!groupName) groupName = config.modchat;
				return "Because moderated chat is set, you must be of rank " + groupName + " or higher to speak in lobby chat.";
			}
		}
	}
	return false;
}

var modlog = modlog || fs.createWriteStream('logs/modlog.txt', {flags:'a+'});
function logModCommand(room, str, noBroadcast) {
	if (!noBroadcast) room.add(str);
	modlog.write('[' + (new Date().toJSON()) + '] (' + room.id + ') ' + str + '\n');
}

function userTargetedPermssion(permission, param) {
	return function (user, command, params) { return user.can(permission, params[param]); };
}
function parseSingleArgument(param) {
	return function (user, command, args) {
		if (args.length < 2) return "Not enough arugments";
		var result = {}
		result[param] = args[1];
		return result;
	};
}

var commands = {
	'nick': 'trn',
	'trn': {
		parseArguments: function (user, command, args) {
			if (args.length < 2) return "Not enough arugments";
			var result = {};
			result.nick = args[1];
			if (args[2]) result.auth = true;
			if (args[3]) {
				args.splice(0, 3);
				result.token = args.join(',');
			}
			return result;
		},
		handler: function (user, command, params, output, room, socket) {
			user.rename(params.nick, params.token, params.auth);
		}
	},
	'mee': 'me',
	'me': {
		isBroadcastable: true,
		handler: function (user, command, args, output, room, socket) {
			var reason = cannotTalk(user, room);
			if (reason) {
				output.write(reason);
				return;
			}
			room.add('|c|' + user.getIdentity() + '|/' + command + (args[0] ? ' ' + args[0] : ''));
		}
	},
	'birkale': 'birkal',
	'birkal': {
		isBroadcastable: true,
		permission: 'broadcast',
		handler: function (user, command, args, output, room, socket) {
			var reason = cannotTalk(user, room);
			if (reason) {
				output.write(reason);
				return;
			}
			room.add('|c| Birkal|/' + (command === 'birkal' ? 'me' : 'mee') + (args[0] ? ' ' + args[0] : ''));
		}
	},

	// Moderator commands
	'nl': 'namelock',
	'namelock': {
		help: "Locks a user's name.\nUsage: /namelock <target user> [, <target name>]",
		permission: 'namelock',
		permissionHandler: userTargetedPermssion('namelock', 'targetUser'),
		parseArguments: function (user, command, args) {
			if (args.length < 2) return "Not enough arguments";

			var result = {}
			result.targetUser = Users.get(args[1]);
			if (!result.targetUser) return "User " + args[1] + " not found.";

			result.targetName = args[1];
			if (args[2]) result.targetName = args[2];
			return result;
		},
		handler: function (user, command, params, output, room, socket) {
			var oldname = params.targetUser.name;
			var targetId = toUserid(params.targetName);
			var userOfName = Users.users[targetId];
			var isAlt = false;
			if (userOfName) {
				for(var altName in userOfName.getAlts()) {
					var altUser = Users.users[toUserid(altName)];
					if (!altUser) continue;
					if (targetId === altUser.userid) {
						isAlt = true;
						break;
					}
					for (var prevName in altUser.prevNames) {
						if (targetId === toUserid(prevName)) {
							isAlt = true;
							break;
						}
					}
					if (isAlt) break;
				}
			}
			if (!userOfName || oldname === params.targetName || isAlt) {
				params.targetUser.nameLock(params.targetName, true);
			}
			if (params.targetUser.nameLocked()) {
				logModCommand(room, user.getIdentity() + " name-locked " + oldname + " to " + params.targetName + ".");
			} else {
				output.write(oldname + " can't be name-locked to " + params.targetName + ".");
			}
		}
	},
	'unl': 'nameunlock',
	'nul': 'nameunlock',
	'unnamelock': 'nameunlock',
	'nameunlock': {
		help: "Unlocks a name-locked user.\nUsage: /nameunlock <target user>",
		permission: 'namelock',
		parseArguments: parseSingleArgument('targetUser'),
		handler: function (user, command, params, output, room, socket) {
			var isRemoved = false;
			for (var ip in nameLockedIps) {
				if (nameLockedIps[ip] === params.targetUser) {
					delete nameLockedIps[ip];
					isRemoved = true;
				}
			}
			if (isRemoved) {
				logModCommand(room, user.getIdentity() + " unlocked the name of " + params.targetUser + ".");
			} else {
				output.write(params.targetUser + " is not name-locked.");
			}
		}
	},

	// Informational commands
	'stats': 'data',
	'data': {
		isBroadcastable: true,
		help: "Get details on a pokemon/item/move/ability.\nUsage: /data <pokemon/item/move/ability>",
		parseArguments: function (user, command, args) {
			if (args.length < 2) return "Not enough arguments";

			var pokemon = Tools.getTemplate(args[1]);
			var item = Tools.getItem(args[1]);
			var move = Tools.getMove(args[1]);
			var ability = Tools.getAbility(args[1]);

			var result = {}
			if (pokemon.exists) result.pokemon = pokemon;
			if (item.exists) result.item = item;
			if (move.exists) result.move = move;
			if (ability.exists) result.ability = ability;

			if (Object.keys(result).length === 0) return "No pokemon, item, move, or ability named '" + args[1] + "' was found. (Check your spelling?)";
			return result;
		},
		handler: function (user, command, params, output, room, socket) {
			if (params.pokemon) output.add("|c|" + user.getIdentity() + "|/data-pokemon " + params.pokemon.id);
			if (params.item) output.add("|c|" + user.getIdentity() + "|/data-item " + params.item.id);
			if (params.move) output.add("|c|" + user.getIdentity() + "|/data-move " + params.move.id);
			if (params.ability) output.add("|c|" + user.getIdentity() + "|/data-ability " + params.ability.id);
		}
	},
	'help': {
		isBroadcastable: true,
		help: "Show help messages for commands.",
		parseArguments: function (user, command, args) {
			var result = {};
			if (command === 'help' && args.length === 0) {
				result.isOverview = true;
			} else if (cmd === 'help' && args.length > 1) {
				result.cmd = args[1];
				var calledCmd = args[1];
				while (typeof commands[calledCmd] === 'string') calledCmd = commands[calledCmd];
				if (!commands[calledCmd]) return "The command '" + cmd + "' doesn't exist. Try /help for general help";
				result.calledCmd = calledCmd;
			} else {
				result.cmd = command;
				result.calledCmd = command;
			}
			return result;
		},
		handler: function (user, command, params, output, room, socket) {
			if (params.isOverview) {
				output.write("TODO: Show help overview");
				return;
			}

			if (!commands[params.calledCmd].help) {
				output.write("The command '" + params.cmd + "' doesn't have a help message.");
				return;
			}

			output.write("Help for command '" + params.cmd + "':");
			if (typeof commands[params.calledCmd].help === 'function') {
				commands[params.calledCmd].help(user, params.cmd, {}, output);
			} else {
				var helpLines = commands[params.calledCmd].help.split('\n');
				for (var l = 0; l < helpLines.length; ++l) output.write(helpLines[l]);
				if (commands[params.calledCmd].permission) {
					output.write("The '" + commands[params.calledCmd].permission + "' permission is required to use this command.");
				}
			}
		}
	}
};

function parse(user, command, room, socket) {
	while (true) {
		var isBroadcasting = command[0] === '!';
		if ((command[0] !== '/' || command[1] === '/') && !isBroadcasting) {
			var reason = cannotTalk(user, room);
			if (reason) {
				emit(socket, 'console', reason);
				return;
			}
			return true;
		}
		command = normaliseSpaces(command);

		var commandIndex = command.indexOf(' ');
		var cmd = "";
		var args = [];
		if (commandIndex >= 0) {
			cmd = command.slice(1, commandIndex);

			var arguments = command.slice(commandIndex + 1);
			args.push(arguments);

			arguments = arguments.split(',');
			for (var a = 0; a < arguments.length; ++a)
				arguments[a] = normaliseSpaces(arguments[a]);
			Array.prototype.push.apply(args, arguments);
		}
		else {
			cmd = command.slice(1);
		}

		var output = {};
		if (isBroadcasting) {
			output = {
				add: function (str) { room.add(str); },
				write: function (str) { room.add('||'+str); },
				writeRaw: function (str) { room.addRaw(str); },
				eval: function (str) { for (var u in room.users) room.users[u].emit('console', {evalRawMessage: str}); }
			};
		}
		else {
			output = {
				add: function (str) { sendData(socket, '>' + room.id + '\n' + str); },
				write: function (str) { emit(socket, 'console', str); },
				writeRaw: function (str) { emit(socket, 'console', {rawMessage: str}); },
				eval: function (str) { emit(socket, 'console', {evalRawMessage: str}); }
			};
		}

		var calledCmd = cmd;
		while (typeof commands[calledCmd] === 'string') calledCmd = commands[calledCmd];
		if (!commands[calledCmd]) {
			// Default case goes here
			if (isBroadcasting) return true;
			emit(socket, 'console', "The command '" + cmd + "' was unrecognized. To send a message starting with '/" + cmd + "', type '//" + cmd + "'. Alternatively, try '/help'");
			return;
		}
		if (isBroadcasting) {
			var reason = cannotTalk(user, room);
			if (reason) {
				emit(socket, 'console', reason);
				return;
			}
			if (!user.can('broadcast')) {
				emit(socket, 'console', "You do not have permission to broadcast this command's information.");
				emit(socket, 'console', "To see it for yourself, use: '/" + command.slice(1) + "'");
				return;
			}
			if (!commands[calledCmd].isBroadcastable) {
				emit(socket, 'console', "This command cannot be broadcasted.");
				emit(socket, 'console', "To see it for yourself, use: '/" + command.slice(1) + "'");
				return;
			}
		}

		var params = args;
		if (commands[calledCmd].parseArguments) params = commands[calledCmd].parseArguments(user, cmd, args);
		if (typeof params !== 'object') {
			emit(socket, 'console', "Error parsing arguments to '" + cmd + "'" + (typeof params === 'string' ? ":" : "."));
			if (typeof params === 'string') emit(socket, 'console', params);
			return;
		}

		var isHasPermission = true;
		if (commands[calledCmd].permissionHandler) {
			isHasPermission = commands[calledCmd].permissionHandler(user, cmd, params);
		} else if (commands[calledCmd].permission) {
			isHasPermission = user.can(commands[calledCmd].permission);
		}
		if (!isHasPermission) {
			emit(socket, 'console', command + " - Access Denied.");
			return;
		}

		if (isBroadcasting) room.add('|c|' + user.getIdentity() + '|' + command);
		var result = commands[calledCmd].handler(user, cmd, params, output, room, socket);
		if (result === false) commands['help'].handler(user, cmd, {cmd: cmd, calledCmd: calledCmd}, output, room, socket);
		if (result === true) return true;
		if (typeof result === 'string') {
			command = result;
			continue;
		}
		return;
	}
}

exports.commands = commands;
exports.parse = parse;
