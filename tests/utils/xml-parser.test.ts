/**
 * @license
 * This software is licensed under AGPL v3. For commercial licensing, see COMMERCIAL_LICENSE.md.
 */

import { describe, it, expect } from "vitest";
import {
  assertXmlResponse,
  parseLegacyOrderXml,
  parseLegacyOrdersSearchXml,
  parseLegacySubscriptionXml,
} from "../../src/utils/xml-parser.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FULL_ORDER_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<order>
  <reference>VI0000000-0000-00000</reference>
  <status>completed</status>
  <statusChanged>2026-02-12T16:46:39.299Z</statusChanged>
  <test>false</test>
  <returnStatus>none</returnStatus>
  <customer>
    <firstName>Jane</firstName>
    <lastName>Doe</lastName>
    <company>Acme Corp</company>
    <email>jane@acme.com</email>
    <phoneNumber>+1234567890</phoneNumber>
  </customer>
  <currency>USD</currency>
  <referrer>https://example.com/</referrer>
  <originIp>1.2.3.4</originIp>
  <total>99</total>
  <tax>0</tax>
  <shipping>0</shipping>
  <orderItems>
    <orderItem>
      <productDisplay>Test Product</productDisplay>
      <productName>test-product-annual</productName>
      <quantity>1</quantity>
    </orderItem>
  </orderItems>
  <payments>
    <payment>
      <status>completed</status>
      <statusChanged>2026-02-12T00:00:00Z</statusChanged>
      <methodType>creditcard</methodType>
      <currency>USD</currency>
      <total>99</total>
    </payment>
  </payments>
</order>`;

const MULTI_ITEM_ORDER_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<order>
  <reference>VI8260212-0001-00001</reference>
  <status>completed</status>
  <customer><email>multi@test.com</email></customer>
  <total>198</total>
  <orderItems>
    <orderItem>
      <productName>product-a</productName>
      <quantity>1</quantity>
    </orderItem>
    <orderItem>
      <productName>product-b</productName>
      <quantity>2</quantity>
    </orderItem>
  </orderItems>
  <payments>
    <payment><status>completed</status><total>100</total></payment>
    <payment><status>completed</status><total>98</total></payment>
  </payments>
</order>`;

const SEARCH_RESULT_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<orders>
  <order>
    <reference>VI0000000-0000-00000</reference>
    <status>completed</status>
    <statusChanged>2026-02-12T16:46:39.299Z</statusChanged>
    <test>false</test>
    <returnStatus>none</returnStatus>
    <customer>
      <firstName>Jane</firstName>
      <lastName>Doe</lastName>
      <company>Acme Corp</company>
      <email>jane@acme.com</email>
    </customer>
  </order>
</orders>`;

const MULTI_RESULT_SEARCH_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<orders>
  <order>
    <reference>REF-1</reference>
    <status>completed</status>
    <customer><email>a@test.com</email></customer>
  </order>
  <order>
    <reference>REF-2</reference>
    <status>pending</status>
    <customer><email>b@test.com</email></customer>
  </order>
</orders>`;

// ---------------------------------------------------------------------------
// parseLegacyOrderXml
// ---------------------------------------------------------------------------

describe("parseLegacyOrderXml", () => {
  it("parses a full order XML response correctly", () => {
    const order = parseLegacyOrderXml(FULL_ORDER_XML);

    expect(order.reference).toBe("VI0000000-0000-00000");
    expect(order.status).toBe("completed");
    expect(order.test).toBe(false);
    expect(order.returnStatus).toBe("none");
    expect(order.currency).toBe("USD");
    expect(order.total).toBe(99);
    expect(order.tax).toBe(0);
    expect(order.shipping).toBe(0);
  });

  it("parses customer fields correctly", () => {
    const order = parseLegacyOrderXml(FULL_ORDER_XML);

    expect(order.customer?.firstName).toBe("Jane");
    expect(order.customer?.lastName).toBe("Doe");
    expect(order.customer?.company).toBe("Acme Corp");
    expect(order.customer?.email).toBe("jane@acme.com");
    expect(order.customer?.phoneNumber).toBe("+1234567890");
  });

  it("parses orderItems as an array", () => {
    const order = parseLegacyOrderXml(FULL_ORDER_XML);

    expect(order.orderItems).toHaveLength(1);
    expect(order.orderItems?.[0].productName).toBe("test-product-annual");
    expect(order.orderItems?.[0].productDisplay).toBe("Test Product");
    expect(order.orderItems?.[0].quantity).toBe(1);
  });

  it("parses multiple orderItems as an array", () => {
    const order = parseLegacyOrderXml(MULTI_ITEM_ORDER_XML);

    expect(order.orderItems).toHaveLength(2);
    expect(order.orderItems?.[0].productName).toBe("product-a");
    expect(order.orderItems?.[1].productName).toBe("product-b");
    expect(order.orderItems?.[1].quantity).toBe(2);
  });

  it("parses payments as an array", () => {
    const order = parseLegacyOrderXml(FULL_ORDER_XML);

    expect(order.payments).toHaveLength(1);
    expect(order.payments?.[0].status).toBe("completed");
    expect(order.payments?.[0].methodType).toBe("creditcard");
    expect(order.payments?.[0].total).toBe(99);
  });

  it("parses multiple payments as an array", () => {
    const order = parseLegacyOrderXml(MULTI_ITEM_ORDER_XML);

    expect(order.payments).toHaveLength(2);
    expect(order.payments?.[0].total).toBe(100);
    expect(order.payments?.[1].total).toBe(98);
  });

  it("returns empty orderItems and payments when elements are absent", () => {
    const minimal = `<?xml version="1.0" encoding="UTF-8"?><order><reference>R1</reference><status>completed</status></order>`;
    const order = parseLegacyOrderXml(minimal);

    expect(order.reference).toBe("R1");
    expect(order.orderItems).toEqual([]);
    expect(order.payments).toEqual([]);
  });

  it("throws when the <order> root element is missing", () => {
    const badXml = `<?xml version="1.0" encoding="UTF-8"?><notAnOrder><foo>bar</foo></notAnOrder>`;
    expect(() => parseLegacyOrderXml(badXml)).toThrow(
      "Legacy API response missing <order> root element"
    );
  });
});

// ---------------------------------------------------------------------------
// parseLegacyOrdersSearchXml
// ---------------------------------------------------------------------------

describe("parseLegacyOrdersSearchXml", () => {
  it("parses a search response with one order correctly", () => {
    const results = parseLegacyOrdersSearchXml(SEARCH_RESULT_XML);

    expect(results).toHaveLength(1);
    expect(results[0].reference).toBe("VI0000000-0000-00000");
    expect(results[0].status).toBe("completed");
    expect(results[0].test).toBe(false);
    expect(results[0].returnStatus).toBe("none");
    expect(results[0].customer?.email).toBe("jane@acme.com");
    expect(results[0].customer?.firstName).toBe("Jane");
    expect(results[0].customer?.company).toBe("Acme Corp");
  });

  it("parses a search response with multiple orders", () => {
    const results = parseLegacyOrdersSearchXml(MULTI_RESULT_SEARCH_XML);

    expect(results).toHaveLength(2);
    expect(results[0].reference).toBe("REF-1");
    expect(results[1].reference).toBe("REF-2");
    expect(results[1].status).toBe("pending");
  });

  it("returns empty array when <orders> wrapper is missing", () => {
    const noWrapper = `<?xml version="1.0" encoding="UTF-8"?><notOrders><order><reference>R1</reference></order></notOrders>`;
    const results = parseLegacyOrdersSearchXml(noWrapper);
    expect(results).toEqual([]);
  });

  it("returns empty array when <orders> element is empty", () => {
    const empty = `<?xml version="1.0" encoding="UTF-8"?><orders></orders>`;
    const results = parseLegacyOrdersSearchXml(empty);
    expect(results).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// assertXmlResponse
// ---------------------------------------------------------------------------

describe("assertXmlResponse", () => {
  it("does not throw for a response beginning with <?xml", () => {
    expect(() =>
      assertXmlResponse('<?xml version="1.0"?><order><reference>R1</reference></order>')
    ).not.toThrow();
  });

  it("does not throw for a response beginning with <", () => {
    expect(() => assertXmlResponse("<order><reference>R1</reference></order>")).not.toThrow();
  });

  it("throws for a plain-text access-denied response", () => {
    expect(() => assertXmlResponse("Access denied to site.")).toThrow(
      "Classic API returned a non-XML response"
    );
  });

  it("throws for a password-required response", () => {
    expect(() => assertXmlResponse("Password is required.")).toThrow(
      "Classic API returned a non-XML response"
    );
  });

  it("throws for HTML error pages", () => {
    expect(() => assertXmlResponse("<!DOCTYPE html><html>")).toThrow(
      "Classic API returned a non-XML response"
    );
  });

  it("handles leading whitespace correctly (still XML)", () => {
    expect(() =>
      assertXmlResponse('  \n<?xml version="1.0"?><order/>')
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// parseLegacySubscriptionXml
// ---------------------------------------------------------------------------

const FULL_SUBSCRIPTION_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<subscription>
  <status>active</status>
  <statusChanged>2013-10-13</statusChanged>
  <statusReason>customer-set</statusReason>
  <cancelable>true</cancelable>
  <reference>VI0000000-0000-00000S</reference>
  <test>false</test>
  <referrer>https://example.com</referrer>
  <sourceName>my-source</sourceName>
  <sourceKey>my-key</sourceKey>
  <sourceCampaign>spring-sale</sourceCampaign>
  <customer>
    <firstName>John</firstName>
    <lastName>Smith</lastName>
    <company>Acme Ltd</company>
    <email>john@acme.com</email>
    <phoneNumber>+44123456789</phoneNumber>
  </customer>
  <customerUrl>https://app.fastspring.com/manage/foo</customerUrl>
  <productName>my-software-annual</productName>
  <tags>vip</tags>
  <quantity>1</quantity>
  <coupon>SAVE10</coupon>
  <nextPeriodDate>2013-11-13</nextPeriodDate>
  <end>2014-10-13</end>
</subscription>`;

const MINIMAL_SUBSCRIPTION_XML = `<?xml version="1.0" encoding="UTF-8"?>
<subscription>
  <reference>VI0000000-0000-00000S</reference>
  <status>active</status>
</subscription>`;

describe("parseLegacySubscriptionXml", () => {
  it("parses a full subscription XML response correctly", () => {
    const sub = parseLegacySubscriptionXml(FULL_SUBSCRIPTION_XML);

    expect(sub.reference).toBe("VI0000000-0000-00000S");
    expect(sub.status).toBe("active");
    expect(sub.statusChanged).toBe("2013-10-13");
    expect(sub.statusReason).toBe("customer-set");
    expect(sub.cancelable).toBe(true);
    expect(sub.test).toBe(false);
    expect(sub.productName).toBe("my-software-annual");
    expect(sub.quantity).toBe(1);
    expect(sub.coupon).toBe("SAVE10");
    expect(sub.nextPeriodDate).toBe("2013-11-13");
    expect(sub.end).toBe("2014-10-13");
  });

  it("parses customer fields correctly", () => {
    const sub = parseLegacySubscriptionXml(FULL_SUBSCRIPTION_XML);

    expect(sub.customer?.firstName).toBe("John");
    expect(sub.customer?.lastName).toBe("Smith");
    expect(sub.customer?.company).toBe("Acme Ltd");
    expect(sub.customer?.email).toBe("john@acme.com");
    expect(sub.customer?.phoneNumber).toBe("+44123456789");
  });

  it("parses source tracking fields correctly", () => {
    const sub = parseLegacySubscriptionXml(FULL_SUBSCRIPTION_XML);

    expect(sub.referrer).toBe("https://example.com");
    expect(sub.sourceName).toBe("my-source");
    expect(sub.sourceKey).toBe("my-key");
    expect(sub.sourceCampaign).toBe("spring-sale");
  });

  it("parses a minimal subscription with only required fields", () => {
    const sub = parseLegacySubscriptionXml(MINIMAL_SUBSCRIPTION_XML);

    expect(sub.reference).toBe("VI0000000-0000-00000S");
    expect(sub.status).toBe("active");
    expect(sub.customer).toBeUndefined();
    expect(sub.quantity).toBeUndefined();
    expect(sub.productName).toBeUndefined();
  });

  it("throws when the <subscription> root element is missing", () => {
    const badXml = `<?xml version="1.0"?><notASubscription><foo>bar</foo></notASubscription>`;
    expect(() => parseLegacySubscriptionXml(badXml)).toThrow(
      "Legacy API response missing <subscription> root element"
    );
  });
});
