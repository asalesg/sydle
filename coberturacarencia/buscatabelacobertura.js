/**
 * ======================
 * @_input (novo formato)
 * ======================
 * { input: "xxx.xxx.xxx-xx" }
 * OU
 * { input: "+55 (11) 99999-9999" }
 *
 * ======================
 * @_output (sucesso)
 * ======================
 * {
 *   cpf: "xxxxxxxxxxx",
 *   totalSubscriptions: 2,
 *   items: [...],
 *   searched: { raw, digits, digitsNo55 } // só quando busca por phone
 * }
 *
 * ======================
 * @_output (erro)
 * ======================
 * {
 *   error: "mensagem"
 * }
 */

/* =========================
   HELPERS
========================= */

function safeGet(obj, path, fallback = null) {
  try {
    const parts = String(path).split(".");
    let cur = obj;
    for (let i = 0; i < parts.length; i++) {
      if (cur == null) return fallback;
      cur = cur[parts[i]];
    }
    return cur === undefined ? fallback : cur;
  } catch (e) {
    return fallback;
  }
}

function toArrayFromAny(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && Array.isArray(raw.items)) return raw.items;
  if (raw && raw._response && Array.isArray(raw._response.body)) return raw._response.body;
  if (raw && Array.isArray(raw.body)) return raw.body;
  if (raw && Array.isArray(raw.data)) return raw.data;
  return [];
}

function extractProductId(subscriptionObj) {
  return (
    safeGet(subscriptionObj, "contract.product._id") ||
    safeGet(subscriptionObj, "contract.productId") ||
    safeGet(subscriptionObj, "product._id") ||
    null
  );
}

/* =========================
   CPF VALIDATION
========================= */

function validateCpf(cpfRaw) {
  const cpf = String(cpfRaw).replace(/\D/g, "");
  if (!cpf || cpf.length !== 11) throw "CPF inválido: deve conter 11 dígitos";
  if (/^(\d)\1+$/.test(cpf)) throw "CPF inválido";

  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(cpf[i]) * (10 - i);
  let digit1 = (sum * 10) % 11; if (digit1 === 10) digit1 = 0;
  if (digit1 !== parseInt(cpf[9])) throw "CPF inválido";

  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(cpf[i]) * (11 - i);
  let digit2 = (sum * 10) % 11; if (digit2 === 10) digit2 = 0;
  if (digit2 !== parseInt(cpf[10])) throw "CPF inválido";

  return cpf;
}

/* =========================
   PHONE
========================= */

function normalizePhone(phoneRaw) {
  const raw = String(phoneRaw);
  const digits = raw.replace(/\D/g, "");
  let digitsNo55 = digits;

  if (digits.length > 11 && digits.indexOf("55") === 0) {
    digitsNo55 = digits.substring(2);
  }

  return { raw, digits, digitsNo55 };
}

function findPersonByPhone(digits, digitsNo55) {
  const query = {
    query: {
      bool: {
        must: [
          {
            nested: {
              path: "phones",
              query: {
                bool: {
                  should: [
                    { term: { "phones.number": digits } },
                    { term: { "phones.number": digitsNo55 } }
                  ],
                  minimum_should_match: 1
                }
              }
            }
          }
        ]
      }
    },
    size: 1
  };

  const result = crm.person._search(query);
  if (result?.hits?.hits?.length) return result.hits.hits[0]._source;
  return null;
}

/* =========================
   CANCELLATION
========================= */

function getCancellationInfoByMembershipId(membershipId) {
  try {
    const search = br.com.wevets.membershipManagement.CancellationRequest._search({
      query: { term: { "membership._id": String(membershipId) } },
      size: 1
    });

    const hit0 =
      safeGet(search, "hits.hits.0._source") ||
      safeGet(search, "hits.hits.0") ||
      (Array.isArray(search) ? search[0] : null) ||
      safeGet(search, "_response.body.hits.hits.0._source") ||
      null;

    if (!hit0) return { cancellationRequestId: null, cancellationReasonId: null };

    const cancellationRequestId = safeGet(hit0, "_id") || safeGet(hit0, "id") || null;

    const cancellationReasonId =
      safeGet(hit0, "cancellationReason._id") ||
      safeGet(hit0, "cancellationReasonId") ||
      safeGet(hit0, "reason._id") ||
      safeGet(hit0, "reasonId") ||
      safeGet(hit0, "data.cancellationReason._id") ||
      safeGet(hit0, "data.cancellationReasonId") ||
      safeGet(hit0, "payload.cancellationReason._id") ||
      safeGet(hit0, "payload.cancellationReasonId") ||
      null;

    return { cancellationRequestId, cancellationReasonId };
  } catch (e) {
    return { cancellationRequestId: null, cancellationReasonId: null };
  }
}

function getCancellationReasonName(reasonId) {
  try {
    if (!reasonId) return null;
    const reason = br.com.wevets.membershipManagement.CancellationReason._get({ _id: String(reasonId) });
    return safeGet(reason, "name", null);
  } catch (e) {
    return null;
  }
}

/* =========================
   RESOLVE CPF (NOVO)
========================= */

function resolveCpfFromInput(inputObj) {
  const value = inputObj?.input;
  if (!value) throw "input obrigatório";

  const digits = String(value).replace(/\D/g, "");

  // tenta CPF primeiro
  if (digits.length === 11) {
    try {
      const cpf = validateCpf(digits);
      return { cpf, source: "cpf" };
    } catch (e) {
      // segue para telefone
    }
  }

  // tenta telefone
  if (digits.length >= 10 && digits.length <= 13) {
    const { raw, digits: d, digitsNo55 } = normalizePhone(value);

    const person = findPersonByPhone(d, digitsNo55);
    if (!person) throw "Pessoa não encontrada para o dado informado.";

    const cpf =
      safeGet(person, "cpf") ||
      safeGet(person, "document") ||
      safeGet(person, "documents.0.number");

    if (!cpf) throw "Pessoa encontrada, mas sem CPF disponível";

    const cpfValidado = validateCpf(cpf);

    return {
      cpf: cpfValidado,
      source: "phone",
      phoneInfo: { raw, digits: d, digitsNo55 }
    };
  }

  throw "Formato inválido. Informe CPF ou telefone válido";
}

/* =========================
   MAIN
========================= */

try {
  if (!_input) throw "input obrigatório";

  const resolved = resolveCpfFromInput(_input);
  const cpf = resolved.cpf;

  const raw = br.com.wevets.InternalFacade.getCustomerSubscription({ cpf });
  const list = toArrayFromAny(raw);

  const items = list.map((row) => {
    const sub = row?.subscription || {};

    const subscriptionId = sub?._id || null;
    const contractId = sub?.contract?._id || null;

    const petName = sub?.pet?.name || null;
    const petId = sub?.pet?.externalCodeGuruvet || null;
    const planName = sub?.contract?.plan || null;

    const subscriptionStatus = sub?.status?.name || null;
    const contractStatus = sub?.contract?.status || null;

    const productId = extractProductId(sub);

    let planCoverageBase64 = null;
    let canGeneratePdf = false;
    let planValue = null;
    let startDate = null;
    let validityDate = null;
    let base = null;

    let cancellationRequestId = null;
    let cancellationReasonId = null;
    let cancellationReasonName = null;

    let error = null;

    try {
      if (!subscriptionId) throw "subscriptionId ausente";

      const membership = br.com.wevets.membershipManagement.Membership._get({ _id: subscriptionId });

      planValue = safeGet(membership, "planValue");
      startDate = safeGet(membership, "startDate");
      validityDate = safeGet(membership, "validityDate");
      base = safeGet(membership, "legacyFlocker");

      if (String(subscriptionStatus).toLowerCase() === "cancelado") {
        const info = getCancellationInfoByMembershipId(subscriptionId);
        cancellationRequestId = info.cancellationRequestId;
        cancellationReasonId = info.cancellationReasonId;
        cancellationReasonName = getCancellationReasonName(cancellationReasonId);
      }

      if (membership?.contractFile?.getContentAsBase64) {
        planCoverageBase64 = membership.contractFile.getContentAsBase64();
        canGeneratePdf = !!planCoverageBase64;
      }
    } catch (e) {
      error = String(e);
    }

    return {
      subscriptionId,
      contractId,
      productId,
      petName,
      petId,
      planName,
      planValue,
      startDate,
      validityDate,
      base,
      subscriptionStatus,
      contractStatus,
      cancellationRequestId,
      cancellationReasonId,
      cancellationReasonName,
      canGeneratePdf,
      planCoverageBase64,
      ...(error ? { error } : {})
    };
  });

  _output = {
    cpf,
    totalSubscriptions: items.length,
    items,
    ...(resolved.source === "phone" ? { searched: resolved.phoneInfo } : {})
  };

} catch (e) {
  _output = { error: String(e) };
}
