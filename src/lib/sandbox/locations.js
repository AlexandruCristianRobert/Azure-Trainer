export const LOCATIONS = {
  westeurope: 'West Europe',
  northeurope: 'North Europe',
  eastus: 'East US',
  eastus2: 'East US 2',
  centralus: 'Central US',
  westus: 'West US',
  westus2: 'West US 2',
  westus3: 'West US 3',
  uksouth: 'UK South',
  ukwest: 'UK West',
  francecentral: 'France Central',
  germanywestcentral: 'Germany West Central',
  swedencentral: 'Sweden Central',
  switzerlandnorth: 'Switzerland North',
  norwayeast: 'Norway East',
  polandcentral: 'Poland Central',
  italynorth: 'Italy North',
  southeastasia: 'Southeast Asia',
  eastasia: 'East Asia',
  japaneast: 'Japan East',
  australiaeast: 'Australia East',
  canadacentral: 'Canada Central',
  brazilsouth: 'Brazil South',
  southafricanorth: 'South Africa North',
  centralindia: 'Central India',
}

export function normalizeLocation(input) {
  if (typeof input !== 'string') return null
  const key = input.toLowerCase().replace(/\s+/g, '')
  return Object.hasOwn(LOCATIONS, key) ? key : null
}

export function displayLocation(code) {
  return LOCATIONS[code] ?? code
}
