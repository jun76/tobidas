export const ELEMENT_DELETE_REQUEST_EVENT = 'tobidas-element-delete-request'
export const SPREAD_DELETE_REQUEST_EVENT = 'tobidas-spread-delete-request'
export const CONTAINER_ELEMENTS_DELETE_REQUEST_EVENT = 'tobidas-container-elements-delete-request'

export interface ElementDeleteRequest {
  spreadId: string
  elementId: string
}

export function requestElementDelete(detail: ElementDeleteRequest) {
  window.dispatchEvent(new CustomEvent<ElementDeleteRequest>(ELEMENT_DELETE_REQUEST_EVENT, { detail }))
}

export function requestSpreadDelete(spreadId: string) {
  window.dispatchEvent(new CustomEvent<string>(SPREAD_DELETE_REQUEST_EVENT, { detail: spreadId }))
}

export interface ContainerElementsDeleteRequest {
  spreadId: string
  parentType: 'left-page' | 'right-page'
}

export function requestContainerElementsDelete(detail: ContainerElementsDeleteRequest) {
  window.dispatchEvent(new CustomEvent<ContainerElementsDeleteRequest>(CONTAINER_ELEMENTS_DELETE_REQUEST_EVENT, { detail }))
}
