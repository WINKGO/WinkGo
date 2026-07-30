#!/usr/bin/env node
/**
 * Lightweight WINK GO smart-home tools.
 *
 * Uses the Node/Electron runtime that already ships with WINK GO. Customers
 * do not need Python, pip, or a developer-machine path. Home Assistant is
 * accessed only through the URL/token explicitly configured on this PC.
 */
'use strict';

const REQUEST_TIMEOUT_MS = 12_000;

const schema = (properties = {}, required = []) => ({
  type: 'object',
  properties,
  ...(required.length ? { required } : {}),
  additionalProperties: false,
});
const string = (description) => ({ type: 'string', description });
const number = (description) => ({ type: 'number', description });
const integer = (description) => ({ type: 'integer', description });
const boolean = (description) => ({ type: 'boolean', description });
const targetProperties = {
  entity_id: string('实体 ID，可用英文逗号分隔多个实体'),
  device_id: string('Home Assistant 设备 ID'),
  area_id: string('Home Assistant 区域 ID'),
};

const tools = [
  {
    name: 'homeassistant.check_connection',
    description: '检查 Home Assistant REST 与 WebSocket 连接。',
    inputSchema: schema(),
  },
  {
    name: 'homeassistant.list_areas',
    description: '列出 Home Assistant 区域。',
    inputSchema: schema({ force_refresh: boolean('忽略缓存并重新读取') }),
  },
  {
    name: 'homeassistant.get_area_entities',
    description: '列出某个 Home Assistant 区域中的实体。',
    inputSchema: schema({
      area_id: string('区域 ID'),
      area_name: string('区域名称'),
      domain: string('可选的实体域过滤，例如 light'),
      limit: integer('最多返回数量'),
      include_attributes: boolean('是否包含完整属性'),
    }),
  },
  {
    name: 'homeassistant.get_target_services',
    description: '获取某个实体、设备或区域可以调用的服务。',
    inputSchema: schema({ ...targetProperties, expand_group: boolean('是否展开实体组') }),
  },
  {
    name: 'homeassistant.get_states',
    description: '读取 Home Assistant 实体状态，可按域或关键词过滤。',
    inputSchema: schema({
      domain: string('实体域，例如 light 或 switch'),
      query: string('实体名称、ID 或属性关键词'),
      limit: integer('最多返回数量'),
      include_attributes: boolean('是否包含完整属性'),
    }),
  },
  {
    name: 'homeassistant.get_entity_state',
    description: '读取一个 Home Assistant 实体的完整状态。',
    inputSchema: schema({ entity_id: string('实体 ID') }, ['entity_id']),
  },
  {
    name: 'homeassistant.list_services',
    description: '列出 Home Assistant 服务。',
    inputSchema: schema({ domain: string('可选的服务域过滤') }),
  },
  {
    name: 'homeassistant.turn_on',
    description: '打开实体、设备或区域。',
    inputSchema: schema(targetProperties),
  },
  {
    name: 'homeassistant.turn_off',
    description: '关闭实体、设备或区域。',
    inputSchema: schema(targetProperties),
  },
  {
    name: 'homeassistant.toggle',
    description: '切换实体、设备或区域开关状态。',
    inputSchema: schema(targetProperties),
  },
  {
    name: 'homeassistant.set_light_brightness',
    description: '设置灯光亮度。',
    inputSchema: schema(
      {
        entity_id: targetProperties.entity_id,
        area_id: targetProperties.area_id,
        brightness: integer('亮度，0 到 255'),
      },
      ['brightness']
    ),
  },
  {
    name: 'homeassistant.set_climate_temperature',
    description: '设置空调或温控设备目标温度。',
    inputSchema: schema(
      {
        entity_id: targetProperties.entity_id,
        area_id: targetProperties.area_id,
        temperature: number('目标温度'),
      },
      ['temperature']
    ),
  },
  {
    name: 'homeassistant.call_service',
    description: '调用 Home Assistant 服务；涉及外部副作用时必须先获得用户确认。',
    inputSchema: schema(
      {
        domain: string('服务域，例如 light'),
        service: string('服务名称，例如 turn_on'),
        ...targetProperties,
        data: {
          description: '服务参数对象或 JSON 字符串',
          oneOf: [{ type: 'object' }, { type: 'string' }],
        },
        return_response: boolean('是否要求返回服务响应'),
      },
      ['domain', 'service']
    ),
  },
  {
    name: 'appliance.list_devices',
    description: '列出本机智能家居注册表中的设备。',
    inputSchema: schema({
      room: string('房间过滤'),
      vendor: string('厂商过滤'),
      device_type: string('设备类型过滤'),
    }),
  },
  {
    name: 'appliance.list_scenes',
    description: '列出本机智能家居注册表中的场景。',
    inputSchema: schema(),
  },
  {
    name: 'appliance.get_device_state',
    description: '读取已注册设备的实时状态。',
    inputSchema: schema({
      device: string('设备名称或别名'),
      room: string('房间'),
      vendor: string('厂商'),
      device_type: string('设备类型'),
      device_id: string('设备 ID'),
    }),
  },
  {
    name: 'appliance.set_power',
    description: '打开或关闭已注册设备。',
    inputSchema: schema(
      {
        device: string('设备名称或别名'),
        room: string('房间'),
        vendor: string('厂商'),
        device_type: string('设备类型'),
        device_id: string('设备 ID'),
        power: { type: 'string', enum: ['on', 'off'], description: '目标电源状态' },
      },
      ['power']
    ),
  },
  {
    name: 'appliance.set_temperature',
    description: '设置已注册温控设备的温度。',
    inputSchema: schema(
      {
        device: string('设备名称或别名'),
        room: string('房间'),
        vendor: string('厂商'),
        device_id: string('设备 ID'),
        temperature: number('目标温度'),
        mode: string('可选的温控模式'),
      },
      ['temperature']
    ),
  },
  {
    name: 'appliance.media_command',
    description: '向已注册媒体设备发送播放、暂停、上一首、下一首或音量命令。',
    inputSchema: schema(
      {
        device: string('设备名称或别名'),
        room: string('房间'),
        vendor: string('厂商'),
        device_type: string('设备类型'),
        device_id: string('设备 ID'),
        command: string('媒体命令'),
        value: string('可选命令值'),
      },
      ['command']
    ),
  },
  {
    name: 'appliance.speaker_speak',
    description: '让已注册智能音箱播报文本。',
    inputSchema: schema(
      {
        text: string('要播报的文本'),
        device: string('音箱名称或别名'),
        room: string('房间'),
        device_id: string('设备 ID'),
      },
      ['text']
    ),
  },
  {
    name: 'appliance.run_scene',
    description: '执行本机智能家居注册表中的场景。',
    inputSchema: schema({ scene: string('场景名称或别名'), scene_id: string('场景 ID') }),
  },
  {
    name: 'appliance.call_vendor_action',
    description: '对已注册设备执行受支持的高级动作。',
    inputSchema: schema(
      {
        action: string('动作名称'),
        device: string('设备名称或别名'),
        room: string('房间'),
        vendor: string('厂商'),
        device_type: string('设备类型'),
        device_id: string('设备 ID'),
        params: {
          description: '动作参数对象或 JSON 字符串',
          oneOf: [{ type: 'object' }, { type: 'string' }],
        },
      },
      ['action']
    ),
  },
];

const parseObject = (value) => {
  if (!value) return {};
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string') throw new Error('参数必须是 JSON 对象。');
  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('参数必须是 JSON 对象。');
  return parsed;
};

const normalizedBaseUrl = (preferences) => {
  const value = String(preferences.homeAssistantUrl || '')
    .trim()
    .replace(/\/+$/, '');
  if (!value) throw new Error('请先在智能家居技能设置中填写 Home Assistant 地址。');
  const endpoint = new URL(value);
  if (!['http:', 'https:'].includes(endpoint.protocol)) throw new Error('Home Assistant 地址必须使用 HTTP 或 HTTPS。');
  return endpoint.toString().replace(/\/$/, '');
};

const requireToken = (preferences) => {
  const token = String(preferences.accessToken || '').trim();
  if (!token) throw new Error('请先在智能家居技能设置中保存 Home Assistant 长期访问令牌。');
  return token;
};

const restRequest = async (preferences, method, apiPath, body) => {
  const endpoint = new URL(`/api/${String(apiPath).replace(/^\/+/, '')}`, normalizedBaseUrl(preferences));
  const response = await fetch(endpoint, {
    method,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${requireToken(preferences)}`,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  if (!response.ok) throw new Error(`Home Assistant 返回 HTTP ${response.status}：${String(text).slice(0, 300)}`);
  return payload;
};

const websocketCommand = async (preferences, command) => {
  const base = new URL(normalizedBaseUrl(preferences));
  const endpoint = new URL('/api/websocket', base);
  endpoint.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
  const token = requireToken(preferences);
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(endpoint);
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error('Home Assistant WebSocket 响应超时。'));
    }, REQUEST_TIMEOUT_MS);
    const finish = (callback, value) => {
      clearTimeout(timer);
      socket.close();
      callback(value);
    };
    socket.addEventListener('error', () => finish(reject, new Error('无法连接 Home Assistant WebSocket。')));
    socket.addEventListener('message', (event) => {
      let message;
      try {
        message = JSON.parse(typeof event.data === 'string' ? event.data : Buffer.from(event.data).toString('utf8'));
      } catch {
        return;
      }
      if (message.type === 'auth_required') {
        socket.send(JSON.stringify({ type: 'auth', access_token: token }));
        return;
      }
      if (message.type === 'auth_invalid') {
        finish(reject, new Error(message.message || 'Home Assistant 访问令牌无效。'));
        return;
      }
      if (message.type === 'auth_ok') {
        socket.send(JSON.stringify({ id: 1, ...command }));
        return;
      }
      if (message.id !== 1) return;
      if (!message.success) {
        finish(reject, new Error(message.error && message.error.message ? message.error.message : '请求失败。'));
        return;
      }
      finish(resolve, message.result);
    });
  });
};

const target = (args) => {
  const value = {};
  for (const key of ['entity_id', 'device_id', 'area_id']) {
    if (args[key]) value[key] = args[key];
  }
  return value;
};

const callService = async (preferences, args) => {
  const serviceData = parseObject(args.data);
  const command = {
    type: 'call_service',
    domain: String(args.domain || '').trim(),
    service: String(args.service || '').trim(),
    service_data: serviceData,
    return_response: Boolean(args.return_response),
  };
  const serviceTarget = target(args);
  if (Object.keys(serviceTarget).length) command.target = serviceTarget;
  if (!command.domain || !command.service) throw new Error('domain 和 service 不能为空。');
  const result = await websocketCommand(preferences, command);
  return { success: true, domain: command.domain, service: command.service, target: serviceTarget, result };
};

const getStates = async (preferences, args) => {
  const states = await restRequest(preferences, 'GET', 'states');
  const domain = String(args.domain || '')
    .trim()
    .toLowerCase();
  const query = String(args.query || '')
    .trim()
    .toLowerCase();
  const limit = Math.max(1, Math.min(Number(args.limit) || 50, 500));
  const filtered = (Array.isArray(states) ? states : [])
    .filter((item) => {
      const entityId = String(item.entity_id || '');
      if (domain && !entityId.startsWith(`${domain}.`)) return false;
      if (!query) return true;
      return `${entityId} ${JSON.stringify(item.attributes || {})}`.toLowerCase().includes(query);
    })
    .slice(0, limit)
    .map((item) => ({
      entity_id: item.entity_id,
      state: item.state,
      name: item.attributes && item.attributes.friendly_name,
      ...(args.include_attributes ? { attributes: item.attributes || {} } : {}),
    }));
  return { success: true, entities: filtered, returned: filtered.length };
};

const resolveDevice = (preferences, args) => {
  const filters = {
    id: String(args.device_id || '')
      .trim()
      .toLowerCase(),
    name: String(args.device || '')
      .trim()
      .toLowerCase(),
    room: String(args.room || '')
      .trim()
      .toLowerCase(),
    vendor: String(args.vendor || '')
      .trim()
      .toLowerCase(),
    type: String(args.device_type || '')
      .trim()
      .toLowerCase(),
  };
  const devices = preferences.appliances || [];
  const device = devices.find((item) => {
    const aliases = Array.isArray(item.aliases) ? item.aliases.map((alias) => String(alias).toLowerCase()) : [];
    return (
      (!filters.id || String(item.id || '').toLowerCase() === filters.id) &&
      (!filters.name ||
        String(item.name || '')
          .toLowerCase()
          .includes(filters.name) ||
        aliases.includes(filters.name)) &&
      (!filters.room || String(item.room || '').toLowerCase() === filters.room) &&
      (!filters.vendor || String(item.vendor || '').toLowerCase() === filters.vendor) &&
      (!filters.type || String(item.type || '').toLowerCase() === filters.type)
    );
  });
  if (!device) throw new Error('没有找到匹配设备；请先在智能家居技能设置中登记设备。');
  if (!device.entity_id) throw new Error('该设备没有关联 Home Assistant entity_id。');
  return device;
};

const applianceService = async (preferences, device, service, data = {}) =>
  callService(preferences, {
    domain: String(device.entity_id).split('.')[0] || 'homeassistant',
    service,
    entity_id: device.entity_id,
    data,
  });

const call = async (name, args, preferences) => {
  if (name === 'homeassistant.check_connection') {
    const started = Date.now();
    const config = await restRequest(preferences, 'GET', 'config');
    await websocketCommand(preferences, { type: 'ping' });
    return { success: true, latency_ms: Date.now() - started, location_name: config && config.location_name };
  }
  if (name === 'homeassistant.get_states') return getStates(preferences, args);
  if (name === 'homeassistant.get_entity_state') {
    return {
      success: true,
      entity: await restRequest(preferences, 'GET', `states/${encodeURIComponent(args.entity_id)}`),
    };
  }
  if (name === 'homeassistant.list_services') {
    const services = await restRequest(preferences, 'GET', 'services');
    const domain = String(args.domain || '').trim();
    const filtered = (Array.isArray(services) ? services : []).filter((item) => !domain || item.domain === domain);
    return { success: true, services: filtered };
  }
  if (name === 'homeassistant.list_areas') {
    const areas = await websocketCommand(preferences, { type: 'config/area_registry/list' });
    return { success: true, areas: areas || [], returned: Array.isArray(areas) ? areas.length : 0 };
  }
  if (name === 'homeassistant.get_area_entities') {
    const [areas, entityPayload, states] = await Promise.all([
      websocketCommand(preferences, { type: 'config/area_registry/list' }),
      websocketCommand(preferences, { type: 'config/entity_registry/list_for_display' }),
      restRequest(preferences, 'GET', 'states'),
    ]);
    const area = (areas || []).find(
      (item) =>
        (args.area_id && item.area_id === args.area_id) ||
        (args.area_name && String(item.name || '').toLowerCase() === String(args.area_name).toLowerCase())
    );
    if (!area) throw new Error('没有找到指定区域。');
    const stateMap = new Map((states || []).map((item) => [item.entity_id, item]));
    const domain = String(args.domain || '').trim();
    const limit = Math.max(1, Math.min(Number(args.limit) || 50, 500));
    const entities = ((entityPayload && entityPayload.entities) || [])
      .filter((item) => item.ai === area.area_id && (!domain || String(item.ei).startsWith(`${domain}.`)))
      .slice(0, limit)
      .map((item) => {
        const state = stateMap.get(item.ei) || {};
        return {
          entity_id: item.ei,
          area_id: area.area_id,
          name: (state.attributes && state.attributes.friendly_name) || item.en || item.ei,
          state: state.state || 'unknown',
          ...(args.include_attributes ? { attributes: state.attributes || {} } : {}),
        };
      });
    return { success: true, area, entities, returned: entities.length };
  }
  if (name === 'homeassistant.get_target_services') {
    const serviceTarget = target(args);
    if (!Object.keys(serviceTarget).length) throw new Error('必须提供 entity_id、device_id 或 area_id。');
    const services = await websocketCommand(preferences, {
      type: 'get_services_for_target',
      target: serviceTarget,
      expand_group: args.expand_group !== false,
    });
    return { success: true, target: serviceTarget, services: services || [] };
  }
  if (name === 'homeassistant.call_service') return callService(preferences, args);
  if (['homeassistant.turn_on', 'homeassistant.turn_off', 'homeassistant.toggle'].includes(name)) {
    return callService(preferences, {
      domain: args.entity_id ? String(args.entity_id).split('.')[0] : 'homeassistant',
      service: name.split('.')[1],
      ...args,
    });
  }
  if (name === 'homeassistant.set_light_brightness') {
    return callService(preferences, {
      domain: 'light',
      service: 'turn_on',
      entity_id: args.entity_id,
      area_id: args.area_id,
      data: { brightness: Math.max(0, Math.min(255, Number(args.brightness) || 0)) },
    });
  }
  if (name === 'homeassistant.set_climate_temperature') {
    return callService(preferences, {
      domain: 'climate',
      service: 'set_temperature',
      entity_id: args.entity_id,
      area_id: args.area_id,
      data: { temperature: Number(args.temperature) },
    });
  }
  if (name === 'appliance.list_devices') {
    const devices = (preferences.appliances || []).filter(
      (item) =>
        (!args.room || item.room === args.room) &&
        (!args.vendor || item.vendor === args.vendor) &&
        (!args.device_type || item.type === args.device_type)
    );
    return { success: true, devices, returned: devices.length };
  }
  if (name === 'appliance.list_scenes') {
    return { success: true, scenes: preferences.scenes || [], returned: (preferences.scenes || []).length };
  }
  if (name === 'appliance.get_device_state') {
    const device = resolveDevice(preferences, args);
    const entity = await restRequest(preferences, 'GET', `states/${encodeURIComponent(device.entity_id)}`);
    return { success: true, device, entity };
  }
  if (name === 'appliance.set_power') {
    const device = resolveDevice(preferences, args);
    return applianceService(preferences, device, args.power === 'on' ? 'turn_on' : 'turn_off');
  }
  if (name === 'appliance.set_temperature') {
    const device = resolveDevice(preferences, args);
    return applianceService(preferences, device, 'set_temperature', {
      temperature: Number(args.temperature),
      ...(args.mode ? { hvac_mode: args.mode } : {}),
    });
  }
  if (name === 'appliance.media_command') {
    const device = resolveDevice(preferences, args);
    const commandMap = {
      play: 'media_play',
      pause: 'media_pause',
      next: 'media_next_track',
      previous: 'media_previous_track',
      volume_up: 'volume_up',
      volume_down: 'volume_down',
    };
    const service = commandMap[String(args.command || '').toLowerCase()];
    if (!service) throw new Error('当前仅支持 play、pause、next、previous、volume_up、volume_down。');
    return applianceService(preferences, device, service, args.value ? { value: args.value } : {});
  }
  if (name === 'appliance.speaker_speak') {
    const device = resolveDevice(preferences, { ...args, device_type: 'speaker' });
    const [domain, service] = String(device.tts_service || 'tts.speak').split('.');
    return callService(preferences, {
      domain,
      service,
      entity_id: device.entity_id,
      data: { message: String(args.text || '') },
    });
  }
  if (name === 'appliance.run_scene') {
    const scene = (preferences.scenes || []).find(
      (item) =>
        (args.scene_id && item.id === args.scene_id) ||
        (args.scene && (item.name === args.scene || (item.aliases || []).includes(args.scene)))
    );
    if (!scene) throw new Error('没有找到指定场景。');
    const results = [];
    for (const action of Array.isArray(scene.actions) ? scene.actions : []) {
      results.push(await call('appliance.call_vendor_action', action, preferences));
    }
    return { success: true, scene, results, executed: results.length };
  }
  if (name === 'appliance.call_vendor_action') {
    const device = resolveDevice(preferences, args);
    const action = String(args.action || '').trim();
    const params = parseObject(args.params);
    if (['turn_on', 'turn_off', 'toggle'].includes(action)) {
      return applianceService(preferences, device, action, params);
    }
    if (action === 'set_temperature') {
      return applianceService(preferences, device, 'set_temperature', params);
    }
    throw new Error(`设备动作 "${action}" 尚未列入 WINK GO 安全白名单。`);
  }
  throw new Error(`Unsupported native smart-home tool: ${name}`);
};

const toMcpResult = (value) => ({
  content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  structuredContent: value,
});

module.exports = { tools, call, toMcpResult };
