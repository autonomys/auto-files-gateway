// SPDX-License-Identifier: Apache-2.0

// Auto-generated , DO NOT EDIT

export interface AddressDetail {

    street: string;

    district: string;

}


export interface CompressionOptions {

    algorithm: string;

    level?: number;

    chunkSize?: number;

}


export interface EncryptionOptions {

    algorithm: string;

    chunkSize?: number;

}


export interface FileUploadOptions {

    compression?: CompressionOptions;

    encryption?: EncryptionOptions;

}


